/**
 * PURE incremental-discovery frontier logic (issue #1086, Phase 1.6).
 *
 * This module contains NO database or network access. It answers the four
 * questions that BOUND repeated provider discovery WITHOUT ever treating a
 * timestamp or an HTTP validator as proof that no provider article was missed
 * (the governing invariant of the whole program):
 *
 *   1. {@link computeNextWatermark} — the next SAFE compound watermark
 *      `(publishedAt, key)` derived ONLY from trusted, watermark-eligible dates.
 *      Sitemap `lastmod` / URL-inferred dates never advance it; future dates
 *      beyond clock tolerance and unresolved trusted-date conflicts stay
 *      anomalies; the watermark never regresses and never jumps past an
 *      unprovable gap.
 *   2. {@link decidePagination} — overlap / consecutive-empty-page termination.
 *      A provider-native cursor is preferred; otherwise non-cursor pagination
 *      stops only after the configured number of CONSECUTIVE pages produced no
 *      NEW identity. One known URL or one old date is INSUFFICIENT to stop.
 *   3. {@link detectGap} — completeness gap: when the observable source window
 *      has rolled PAST the last proven boundary we cannot prove nothing was
 *      missed, so we mark {@link DiscoveryGapState.DETECTED}, keep recording
 *      current confirmable candidates, and emit a redacted manual-backfill
 *      suggestion — WITHOUT fetching any historical body.
 *   4. {@link calibrateValidator} — an ETag/Last-Modified `304` is a request
 *      optimization ONLY. Compared against a periodic UNCONDITIONAL calibration
 *      scan over the same overlap, a validator proven stale/misleading is
 *      disabled and an alert is raised so a bad long-lived `304` can never
 *      permanently suppress discovery.
 *
 * Keeping this logic pure (like `classify.ts`) makes every scenario the issue
 * lists — same-timestamp, out-of-order, delayed entries, future dates, date
 * conflicts, a ten-day outage, a rolled feed window, and conditional-request
 * calibration — separately unit-testable with NO real network and NO database,
 * and guarantees routes/scripts/workers cannot re-implement the frontier rules.
 * The thin persistence layer (`frontier-commit.ts`) applies these decisions.
 */
import { CandidateDateProvenance, DiscoveryGapState, DiscoverySourceHealth } from "@prisma/client";

import { redactUrlForLog } from "@/lib/scraper/url-redaction";

// ---------------------------------------------------------------------------
// Compound watermark
// ---------------------------------------------------------------------------

/**
 * The compound "first observed after baseline" frontier position persisted on
 * `DiscoverySource` as `(watermarkAt, watermarkKey)`. `key` is a SANITIZED
 * identity/stable-item key (never a raw URL); it breaks ties between items that
 * share `at` so a same-timestamp item can never be silently skipped.
 */
export type CompoundWatermark = {
  at: Date;
  /** Sanitized identity/stable-item key at {@link at} (never a raw URL). */
  key: string;
};

/**
 * Provenance values that are ELIGIBLE to advance a date watermark by default:
 * a provider RSS/API publication field (`FEED`) or an approved structured page
 * field (`PAGE_METADATA`). Everything else — a URL-inferred date (`URL`), an
 * `HTTP_HEADER` (ETag/Last-Modified are optimizations, not truth), an
 * `INFERRED` date, or an `UNKNOWN`/undated item — CANNOT advance the watermark.
 * Sitemap `lastmod` is intentionally excluded: adapters must not present it as a
 * watermark-eligible date (it is not an approved structured publication field).
 */
export const DEFAULT_WATERMARK_ELIGIBLE_PROVENANCES: readonly CandidateDateProvenance[] = [
  CandidateDateProvenance.FEED,
  CandidateDateProvenance.PAGE_METADATA,
];

/** Default tolerance for a publication date that is ahead of "now" (5 minutes). */
export const DEFAULT_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * A trusted-dated observation considered for watermark advancement. `sourceRank`
 * expresses configured source precedence for resolving conflicting dates for the
 * SAME identity (a higher rank wins); omit it when the source has no precedence.
 */
export type WatermarkObservation = {
  /** Sanitized identity/stable-item key (never a raw URL). */
  key: string;
  /** The item's publication date. */
  publishedAt: Date;
  /** Where {@link publishedAt} came from — gates watermark eligibility. */
  provenance: CandidateDateProvenance;
  /** Configured source precedence for date-conflict resolution (higher wins). */
  sourceRank?: number;
};

/** Declarative, data-only watermark policy (a Provider may carry one). */
export type WatermarkPolicy = {
  /**
   * Provenances allowed to advance the watermark. Defaults to
   * {@link DEFAULT_WATERMARK_ELIGIBLE_PROVENANCES}. An empty array disables
   * date-watermark advancement entirely (e.g. a pure cursor source).
   */
  eligibleProvenances?: readonly CandidateDateProvenance[];
  /** Future-date tolerance in ms. Defaults to {@link DEFAULT_CLOCK_TOLERANCE_MS}. */
  clockToleranceMs?: number;
};

/** A per-identity conflict between two trusted dates that precedence did NOT resolve. */
export type WatermarkDateConflict = {
  key: string;
};

/** Outcome of {@link computeNextWatermark}. */
export type WatermarkAdvanceResult = {
  /**
   * The watermark to persist. `null` only when there was no prior watermark AND
   * nothing eligible advanced it. Never a regression from {@link current}.
   */
  next: CompoundWatermark | null;
  /** True when {@link next} is strictly ahead of {@link current}. */
  advanced: boolean;
  /** Count of items rejected because their date was beyond clock tolerance. */
  futureRejected: number;
  /** Count of items ignored because their provenance is not watermark-eligible. */
  ineligible: number;
  /** Per-identity trusted-date conflicts precedence could not resolve (anomalies). */
  conflicts: WatermarkDateConflict[];
};

function compareWatermark(a: CompoundWatermark, b: CompoundWatermark): number {
  const dt = a.at.getTime() - b.at.getTime();
  if (dt !== 0) return dt;
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}

function isEligibleProvenance(
  provenance: CandidateDateProvenance,
  eligible: readonly CandidateDateProvenance[],
): boolean {
  return eligible.includes(provenance);
}

/**
 * Computes the next SAFE compound watermark from a batch of trusted-dated
 * observations, honoring every anomaly rule the issue lists:
 *
 *   - Only {@link WatermarkPolicy.eligibleProvenances} (default FEED /
 *     PAGE_METADATA) can advance the watermark. Sitemap `lastmod` / URL-inferred
 *     / HTTP-header / inferred / undated observations are ignored (`ineligible`).
 *   - A date more than `clockToleranceMs` ahead of {@link now} is an anomaly and
 *     is rejected (`futureRejected`) — it can NEVER advance the watermark.
 *   - When the SAME identity carries two DIFFERENT trusted dates, configured
 *     source precedence (`sourceRank`, higher wins) resolves it; an UNRESOLVED
 *     conflict (equal or absent ranks, differing dates) stays an anomaly
 *     (`conflicts`) and does NOT contribute a date.
 *   - The watermark is the max compound `(at, key)` of the surviving eligible
 *     observations, but it NEVER regresses below {@link current} and NEVER jumps
 *     past a `blockedAbove` bound (an unprovable gap boundary): observations at
 *     or after `blockedAbove` are held back so a detected gap is not silently
 *     leapfrogged.
 *
 * Deterministic for a stable input order and free of DB/network access.
 */
export function computeNextWatermark(
  current: CompoundWatermark | null,
  observations: readonly WatermarkObservation[],
  options: {
    now: Date;
    policy?: WatermarkPolicy;
    /**
     * Exclusive upper bound: observations dated at or after this instant are NOT
     * allowed to advance the watermark (used to avoid leapfrogging an unprovable
     * gap). Omit for no upper bound.
     */
    blockedAbove?: Date | null;
  },
): WatermarkAdvanceResult {
  const eligible = options.policy?.eligibleProvenances ?? DEFAULT_WATERMARK_ELIGIBLE_PROVENANCES;
  const toleranceMs = options.policy?.clockToleranceMs ?? DEFAULT_CLOCK_TOLERANCE_MS;
  const futureCutoff = options.now.getTime() + toleranceMs;
  const blockedAbove = options.blockedAbove ?? null;

  let futureRejected = 0;
  let ineligible = 0;

  // Resolve per-identity trusted date by configured precedence. A differing
  // date at equal/absent precedence is an unresolved conflict (anomaly).
  type Resolved = { key: string; at: Date; rank: number };
  const resolvedByKey = new Map<string, Resolved>();
  const conflictKeys = new Set<string>();

  for (const obs of observations) {
    if (!isEligibleProvenance(obs.provenance, eligible)) {
      ineligible += 1;
      continue;
    }
    const t = obs.publishedAt.getTime();
    if (Number.isNaN(t)) {
      ineligible += 1;
      continue;
    }
    if (t > futureCutoff) {
      futureRejected += 1;
      continue;
    }
    const rank = obs.sourceRank ?? 0;
    const prior = resolvedByKey.get(obs.key);
    if (!prior) {
      resolvedByKey.set(obs.key, { key: obs.key, at: obs.publishedAt, rank });
      continue;
    }
    if (prior.at.getTime() === t) continue; // same date, no conflict
    if (rank > prior.rank) {
      resolvedByKey.set(obs.key, { key: obs.key, at: obs.publishedAt, rank });
    } else if (rank < prior.rank) {
      // prior (higher precedence) wins; nothing to do.
    } else {
      // Equal precedence, differing dates → unresolved conflict.
      conflictKeys.add(obs.key);
    }
  }

  // Conflicted identities contribute NO date and are surfaced as anomalies.
  const conflicts: WatermarkDateConflict[] = [];
  for (const key of conflictKeys) {
    resolvedByKey.delete(key);
    conflicts.push({ key });
  }

  let best: CompoundWatermark | null = null;
  for (const resolved of resolvedByKey.values()) {
    if (blockedAbove && resolved.at.getTime() >= blockedAbove.getTime()) continue;
    const candidate: CompoundWatermark = { at: resolved.at, key: resolved.key };
    if (best === null || compareWatermark(candidate, best) > 0) best = candidate;
  }

  if (best === null) {
    return { next: current, advanced: false, futureRejected, ineligible, conflicts };
  }
  if (current !== null && compareWatermark(best, current) <= 0) {
    // Never regress: a lower/equal computed watermark keeps the proven one.
    return { next: current, advanced: false, futureRejected, ineligible, conflicts };
  }
  return { next: best, advanced: true, futureRejected, ineligible, conflicts };
}

// ---------------------------------------------------------------------------
// Overlap / pagination termination
// ---------------------------------------------------------------------------

/** Declarative, data-only overlap / termination policy (a Provider may carry one). */
export type OverlapPolicy = {
  /**
   * Number of most-recent identities to ALWAYS re-scan each run so delayed /
   * out-of-order entries near the frontier are re-observed (known ones dedup,
   * genuinely new ones are admitted). Defaults to {@link DEFAULT_OVERLAP_SIZE}.
   */
  overlapSize?: number;
  /**
   * CONSECUTIVE all-known pages required before non-cursor pagination may stop.
   * One known URL / one old date is insufficient. Defaults to
   * {@link DEFAULT_CONSECUTIVE_EMPTY_PAGES}.
   */
  consecutiveEmptyPages?: number;
};

export const DEFAULT_OVERLAP_SIZE = 25;
export const DEFAULT_CONSECUTIVE_EMPTY_PAGES = 2;

/** What the caller should do after committing the current page. */
export type PaginationDecision =
  | { action: "continue"; reason: "cursor" | "new-identities" | "insufficient-empty-streak" }
  | { action: "stop"; reason: "caught-up" | "boundary" };

export type PaginationState = {
  /** New (previously-unknown) identities admitted on the just-committed page. */
  newIdentityCount: number;
  /**
   * How many CONSECUTIVE pages (including this one) produced zero new identity,
   * AFTER applying this page's {@link newIdentityCount}.
   */
  consecutiveEmptyPages: number;
  /** True when a provider-native cursor is still driving pagination. */
  hasCursor: boolean;
  /** True when the adapter reported it reached the observable boundary. */
  boundaryReached: boolean;
};

/**
 * Decides whether to keep paginating. A provider-native cursor is authoritative:
 * keep going until the cursor is exhausted ({@link PaginationState.hasCursor}
 * false) or the boundary is explicitly reached. For non-cursor pagination we
 * stop as CAUGHT-UP only after the configured number of CONSECUTIVE empty pages;
 * a single known URL or old date (one empty page, or new identities on this
 * page) is INSUFFICIENT to stop.
 */
export function decidePagination(
  state: PaginationState,
  policy: OverlapPolicy = {},
): PaginationDecision {
  const threshold = policy.consecutiveEmptyPages ?? DEFAULT_CONSECUTIVE_EMPTY_PAGES;

  if (state.hasCursor) {
    if (state.boundaryReached) return { action: "stop", reason: "boundary" };
    return { action: "continue", reason: "cursor" };
  }
  if (state.newIdentityCount > 0) {
    return { action: "continue", reason: "new-identities" };
  }
  if (state.consecutiveEmptyPages >= threshold) {
    return { action: "stop", reason: "caught-up" };
  }
  return { action: "continue", reason: "insufficient-empty-streak" };
}

/**
 * The lower window bound to feed `classify.ts` for this run: the proven
 * watermark shifted DOWN by the configured overlap so the most-recent
 * {@link OverlapPolicy.overlapSize} identities are always re-scanned. Returns
 * the watermark timestamp itself when no overlap depth is provided.
 *
 * `recentTimestamps` are the eligible publication dates observed near the
 * frontier on the previous run, most-recent first; the overlap boundary is the
 * `overlapSize`-th of them (older ones stay outside the window). When fewer than
 * `overlapSize` are known, the window opens to the oldest known one so nothing
 * within the intended overlap depth is excluded.
 */
export function overlapWindowStart(
  watermark: CompoundWatermark | null,
  recentTimestamps: readonly Date[],
  policy: OverlapPolicy = {},
): Date | null {
  if (watermark === null) return null;
  const overlapSize = policy.overlapSize ?? DEFAULT_OVERLAP_SIZE;
  if (overlapSize <= 0 || recentTimestamps.length === 0) return watermark.at;

  const sorted = [...recentTimestamps].sort((a, b) => b.getTime() - a.getTime());
  const boundaryIndex = Math.min(overlapSize, sorted.length) - 1;
  const overlapBoundary = sorted[boundaryIndex];
  // Open the window to the OLDER of (watermark, overlap boundary) so the overlap
  // depth is always re-scanned; never move the window forward past the proven
  // watermark (that would re-exclude the overlap).
  return overlapBoundary.getTime() < watermark.at.getTime() ? overlapBoundary : watermark.at;
}

// ---------------------------------------------------------------------------
// Gap detection
// ---------------------------------------------------------------------------

export type GapDecision = {
  state: DiscoveryGapState;
  /** A redacted, metadata-only backfill suggestion note (never a raw URL / body). */
  note: string | null;
};

/**
 * Decides the completeness gap state by comparing the OLDEST item still visible
 * in the source's current window against the last proven boundary
 * (`watermarkAt ?? baselineCompletedAt`).
 *
 *   - No proven boundary yet, or the window still reaches at/below it → `NONE`
 *     (we can still observe everything after the boundary).
 *   - The oldest observable item is NEWER than the proven boundary → the feed
 *     has ROLLED past it: items between the boundary and the window's oldest
 *     item may exist and can no longer be observed here → `DETECTED` with a
 *     redacted manual-backfill suggestion. Current new candidates keep flowing.
 *   - `windowOldest` unknown (empty/failed observation) → `SUSPECTED` at most; a
 *     failed/partial read must never be treated as proof of completeness.
 *
 * NEVER triggers a historical body fetch or an automatic backfill — it only
 * surfaces the gap.
 */
export function detectGap(input: {
  provenBoundary: Date | null;
  /** Oldest item still observable in the current source window, if known. */
  windowOldest: Date | null;
  /** Whether the current run actually reached the observable boundary. */
  boundaryReached: boolean;
  /** Redacted source label (e.g. `redactUrlForLog(feedUrl)`) for the note. */
  sourceLabel?: string;
}): GapDecision {
  const { provenBoundary, windowOldest, boundaryReached, sourceLabel } = input;

  // With no proven boundary there is nothing to have rolled past yet.
  if (provenBoundary === null) return { state: DiscoveryGapState.NONE, note: null };

  if (windowOldest === null) {
    // We could not observe the window's oldest item and did not reach the
    // boundary: we cannot prove completeness, but we cannot prove a gap either.
    if (!boundaryReached) {
      return {
        state: DiscoveryGapState.SUSPECTED,
        note: buildGapNote("suspected", provenBoundary, null, sourceLabel),
      };
    }
    return { state: DiscoveryGapState.NONE, note: null };
  }

  if (windowOldest.getTime() > provenBoundary.getTime()) {
    // The window's oldest visible item is newer than the proven boundary: the
    // feed rolled past it and the intervening span is no longer observable.
    return {
      state: DiscoveryGapState.DETECTED,
      note: buildGapNote("detected", provenBoundary, windowOldest, sourceLabel),
    };
  }

  return { state: DiscoveryGapState.NONE, note: null };
}

function buildGapNote(
  kind: "suspected" | "detected",
  provenBoundary: Date,
  windowOldest: Date | null,
  sourceLabel: string | undefined,
): string {
  const label = sourceLabel ? redactUrlForLog(sourceLabel) : "source";
  const from = provenBoundary.toISOString();
  if (kind === "detected" && windowOldest) {
    return (
      `manual-backfill-suggested: ${label} window rolled past proven boundary ` +
      `${from}; oldest observable item ${windowOldest.toISOString()} — the span ` +
      `(${from}, ${windowOldest.toISOString()}) is no longer discoverable here. ` +
      `Suggest a bounded operator backfill; NOT auto-fetched.`
    );
  }
  return (
    `completeness-suspected: ${label} did not reach the observable boundary and ` +
    `the oldest visible item is unknown (proven boundary ${from}). Re-run to ` +
    `confirm; NOT auto-fetched.`
  );
}

// ---------------------------------------------------------------------------
// Validator calibration
// ---------------------------------------------------------------------------

/**
 * Result of an UNCONDITIONAL calibration scan over the same overlap, compared
 * against what a prior conditional request reported.
 */
export type CalibrationInput = {
  /**
   * What a conditional request (If-None-Match / If-Modified-Since) most recently
   * reported: `true` means the validator asserted "not modified" (`304`).
   */
  conditionalReportedNotModified: boolean;
  /**
   * New identities the UNCONDITIONAL calibration scan found over the same
   * overlap. A `304` that claims "nothing changed" is DISPROVEN when the
   * unconditional scan surfaces new identities.
   */
  unconditionalNewIdentityCount: number;
  /** Whether the unconditional calibration scan actually completed. */
  calibrationCompleted: boolean;
};

export type CalibratorDecision = {
  /** True when the validator is proven stale/misleading and must be disabled. */
  disableValidator: boolean;
  /** True when operators should be alerted. */
  alert: boolean;
  /** Redacted, metadata-only reason (never a raw URL / body). */
  reason:
    | "validator-stale-304-with-new-identities"
    | "validator-consistent"
    | "calibration-incomplete";
};

/**
 * Decides whether a source validator (ETag/Last-Modified) is stale or misleading.
 * ETag/Last-Modified are request OPTIMIZATIONS only: a `304` is trustworthy only
 * while a periodic unconditional scan over the same overlap AGREES that nothing
 * new appeared. When the conditional path reported "not modified" but the
 * unconditional calibration scan found new identities, the validator is proven
 * misleading → disable it and alert, so a bad long-lived `304` can never
 * permanently suppress discovery. An incomplete calibration proves nothing and
 * never disables a validator.
 */
export function calibrateValidator(input: CalibrationInput): CalibratorDecision {
  if (!input.calibrationCompleted) {
    return { disableValidator: false, alert: false, reason: "calibration-incomplete" };
  }
  if (input.conditionalReportedNotModified && input.unconditionalNewIdentityCount > 0) {
    return {
      disableValidator: true,
      alert: true,
      reason: "validator-stale-304-with-new-identities",
    };
  }
  return { disableValidator: false, alert: false, reason: "validator-consistent" };
}

// ---------------------------------------------------------------------------
// Boundary / caught-up accounting
// ---------------------------------------------------------------------------

export type RunCompletionInput = {
  /** The adapter reported it reached the observable boundary this run. */
  boundaryReached: boolean;
  /** The run finished every planned page without a fetch failure. */
  pagesFullyProcessed: boolean;
};

export type RunCompletionDecision = {
  /** True only when the source can be considered caught up to the boundary. */
  caughtUp: boolean;
  /** Suggested health when caught up / not (callers may override). */
  health: DiscoverySourceHealth;
};

/**
 * A source is CAUGHT UP only when the run BOTH reached the observable boundary
 * AND processed every planned page without a failure. A failed or partial page
 * can never mark the source caught up (governing invariant: never treat an
 * incomplete run as proof of completeness).
 */
export function decideRunCompletion(input: RunCompletionInput): RunCompletionDecision {
  const caughtUp = input.boundaryReached && input.pagesFullyProcessed;
  return {
    caughtUp,
    health: caughtUp ? DiscoverySourceHealth.HEALTHY : DiscoverySourceHealth.DEGRADED,
  };
}
