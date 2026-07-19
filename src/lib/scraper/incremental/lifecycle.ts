/**
 * PURE discovery-source lifecycle logic (issue #1088, Phase 1.8).
 *
 * This module contains NO database or network access. It answers the three
 * decisions that govern a source's progression through its lifecycle, WITHOUT
 * ever fetching an article body, writing an Article, or enqueuing ingest work
 * (the governing invariant of the whole program):
 *
 *   1. {@link classifyLifecycleTransition} — the SAFE lifecycle state machine.
 *      The forward progression is `DISABLED → BASELINE → SHADOW → ACTIVE`; a
 *      source may be PAUSED from any active-ish state and RESUMED, safely ROLLED
 *      BACK one step toward DISABLED, or RETIRED. Every other transition is
 *      refused so activation stays explicit and auditable.
 *   2. {@link decideBaselineCompletion} — the baseline-completion GATE. A
 *      baseline is the source's normal incremental observable window (NOT its
 *      full archive); it can complete ONLY when EVERY configured page/shard/
 *      cursor segment reached its boundary AND committed its checkpoint (reusing
 *      the #1086 `decideRunCompletion` accounting). Any failed or uncommitted
 *      segment refuses completion.
 *   3. {@link selectActivationCatchUp} — the activation catch-up SELECTOR. Given
 *      the source's post-baseline shadow candidates and the per-source limits
 *      ({@link DEFAULT_CATCHUP_AGE_DAYS} = 7 days, {@link DEFAULT_CATCHUP_MAX_COUNT}
 *      = 100), it deterministically picks the eligible set to queue: newest
 *      first, stopping at EITHER limit, leaving older/over-limit candidates as
 *      shadow observations. Deterministic ordering makes activation idempotent
 *      on retry (a re-run selects the same set; already-queued candidates are no
 *      longer DISCOVERED shadow candidates, so nothing new is queued).
 *
 * Keeping this logic pure (like `classify.ts`, `frontier.ts`, and `schedule.ts`)
 * makes every scenario — transition validity, partial baselines, the second-scan
 * cutover, and the age/count catch-up limits — separately unit-testable with NO
 * real database or clock, and guarantees the thin persistence layer
 * (`lifecycle-commit.ts`) is the only place these decisions are applied.
 */
import { DiscoverySourceLifecycleMode } from "@prisma/client";

import { decideRunCompletion } from "./frontier";

const M = DiscoverySourceLifecycleMode;

// ---------------------------------------------------------------------------
// Lifecycle state machine
// ---------------------------------------------------------------------------

/**
 * Classification of a proposed lifecycle transition. Every allowed transition is
 * one of these kinds; an unlisted `(from, to)` pair is invalid (`null`).
 *   - `forward`  — advance one step along `DISABLED → BASELINE → SHADOW → ACTIVE`.
 *   - `pause`    — suspend an active-ish source (`BASELINE`/`SHADOW`/`ACTIVE`).
 *   - `resume`   — leave `PAUSED` back into an active-ish mode.
 *   - `rollback` — step one stage back toward `DISABLED` (safe unwind).
 *   - `retire`   — permanently stop a source (terminal `RETIRED`).
 */
export type LifecycleTransitionKind = "forward" | "pause" | "resume" | "rollback" | "retire";

/** The active-ish modes a source may be paused from / resumed into. */
export const ACTIVEISH_MODES: readonly DiscoverySourceLifecycleMode[] = [M.BASELINE, M.SHADOW, M.ACTIVE];

/** Single forward step along the progression. */
const FORWARD_NEXT: Partial<Record<DiscoverySourceLifecycleMode, DiscoverySourceLifecycleMode>> = {
  [M.DISABLED]: M.BASELINE,
  [M.BASELINE]: M.SHADOW,
  [M.SHADOW]: M.ACTIVE,
};

/** Single safe rollback step toward DISABLED (the reverse of {@link FORWARD_NEXT}). */
const ROLLBACK_PREV: Partial<Record<DiscoverySourceLifecycleMode, DiscoverySourceLifecycleMode>> = {
  [M.ACTIVE]: M.SHADOW,
  [M.SHADOW]: M.BASELINE,
  [M.BASELINE]: M.DISABLED,
  // A paused source may also be safely abandoned back to DISABLED.
  [M.PAUSED]: M.DISABLED,
};

/**
 * Classifies a proposed `from → to` lifecycle transition, returning its kind or
 * `null` when the transition is not allowed. This is the SINGLE source of truth
 * for which transitions the persistence layer may apply.
 *
 * A no-op (`from === to`) is treated as invalid so callers must be explicit; the
 * persistence layer handles idempotent re-application separately.
 */
export function classifyLifecycleTransition(
  from: DiscoverySourceLifecycleMode,
  to: DiscoverySourceLifecycleMode,
): LifecycleTransitionKind | null {
  if (from === to) return null;
  // RETIRED is terminal: no outgoing transitions.
  if (from === M.RETIRED) return null;
  // Any non-retired source may be retired (a permanent, safe stop).
  if (to === M.RETIRED) return "retire";
  if (FORWARD_NEXT[from] === to) return "forward";
  if (to === M.PAUSED && ACTIVEISH_MODES.includes(from)) return "pause";
  if (from === M.PAUSED && ACTIVEISH_MODES.includes(to)) return "resume";
  if (ROLLBACK_PREV[from] === to) return "rollback";
  return null;
}

/** True when `from → to` is an allowed lifecycle transition. */
export function isValidLifecycleTransition(
  from: DiscoverySourceLifecycleMode,
  to: DiscoverySourceLifecycleMode,
): boolean {
  return classifyLifecycleTransition(from, to) !== null;
}

// ---------------------------------------------------------------------------
// Body-work prohibition guard
// ---------------------------------------------------------------------------

/**
 * Modes in which article-body fetches, Article writes, and article-processing
 * jobs are STRUCTURALLY PROHIBITED. During BASELINE and SHADOW the source is
 * only observing/​proving identities; it must never touch a body. (Phase 1 as a
 * whole performs no ingestion — real body work is Phase 2 / #1091 — but this
 * guard names the invariant explicitly so an accidental call is refused and
 * testable.)
 */
export const BODY_WORK_PROHIBITED_MODES: readonly DiscoverySourceLifecycleMode[] = [
  M.BASELINE,
  M.SHADOW,
];

/** True when article-body work must be refused for the given lifecycle mode. */
export function isBodyWorkProhibited(mode: DiscoverySourceLifecycleMode): boolean {
  return BODY_WORK_PROHIBITED_MODES.includes(mode);
}

// ---------------------------------------------------------------------------
// Baseline-completion gate
// ---------------------------------------------------------------------------

/**
 * Completion state of ONE observable baseline segment (a configured page range,
 * shard, or cursor stream). `segmentId` is a sanitized, metadata-only key.
 */
export type BaselineSegmentState = {
  /** Sanitized identifier of the segment (never a raw URL/secret). */
  segmentId: string;
  /** The adapter reported this segment reached its observable boundary. */
  boundaryReached: boolean;
  /** Every planned page of the segment committed its checkpoint without a fault. */
  pagesFullyProcessed: boolean;
};

/** Outcome of {@link decideBaselineCompletion}. */
export type BaselineCompletionDecision = {
  /** True only when there is at least one segment and ALL segments completed. */
  complete: boolean;
  /** Sanitized ids of segments that did not reach boundary or commit their checkpoint. */
  incompleteSegments: string[];
};

/**
 * Decides whether a source's baseline may complete. A baseline requires EVERY
 * configured observable segment to complete; a segment is complete only when it
 * BOTH reached its boundary AND processed every planned page (reusing the pure
 * #1086 {@link decideRunCompletion} — a partial/failed run can never be treated
 * as complete). An empty segment set can NEVER complete (there is nothing proven
 * observed), so a misconfigured source cannot silently skip its baseline.
 *
 * Deterministic and free of DB/network access.
 */
export function decideBaselineCompletion(input: {
  segments: readonly BaselineSegmentState[];
}): BaselineCompletionDecision {
  const incompleteSegments = input.segments
    .filter(
      (segment) =>
        !decideRunCompletion({
          boundaryReached: segment.boundaryReached,
          pagesFullyProcessed: segment.pagesFullyProcessed,
        }).caughtUp,
    )
    .map((segment) => segment.segmentId);

  const complete = input.segments.length > 0 && incompleteSegments.length === 0;
  return { complete, incompleteSegments };
}

// ---------------------------------------------------------------------------
// Activation catch-up selector
// ---------------------------------------------------------------------------

/** Default catch-up age window on activation: seven days. */
export const DEFAULT_CATCHUP_AGE_DAYS = 7;
/** Default catch-up count cap on activation: one hundred candidates. */
export const DEFAULT_CATCHUP_MAX_COUNT = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A post-baseline shadow candidate considered for activation catch-up — i.e. a
 * NEW identity first observed while the source was in SHADOW mode (status
 * `DISCOVERED`, `observedInBaseline = false`). Baseline observations
 * (`observedInBaseline = true`) are NEVER catch-up candidates.
 */
export type ShadowCatchUpCandidate = {
  /** `CrawlCandidate.id`. */
  id: string;
  /** Sanitized identity key; the stable tiebreak for deterministic ordering. */
  provisionalKey: string;
  /** When the shadow first observed this identity. */
  firstObservedAt: Date;
  /** Trusted publication date when known; preferred as the age reference. */
  trustedPublishedAt?: Date | null;
};

/** Per-source catch-up limits. Either limit stops catch-up. */
export type CatchUpLimits = {
  /** Max age (days) of a catch-up candidate. Defaults to {@link DEFAULT_CATCHUP_AGE_DAYS}. */
  ageDays?: number;
  /** Max number of candidates queued. Defaults to {@link DEFAULT_CATCHUP_MAX_COUNT}. */
  maxCount?: number;
};

/** Outcome of {@link selectActivationCatchUp}. */
export type ActivationCatchUpDecision = {
  /** Candidate ids to queue (`DISCOVERED → QUEUED`), newest first. */
  queue: string[];
  /** Candidate ids left as shadow observations (too old or over the count cap). */
  deferred: string[];
  /** The effective age cutoff instant used (candidates older than this are deferred). */
  ageCutoff: Date;
};

/** Age reference for a shadow candidate: its trusted publication date, else first-observed. */
function ageReference(candidate: ShadowCatchUpCandidate): Date {
  return candidate.trustedPublishedAt ?? candidate.firstObservedAt;
}

/**
 * Deterministically selects which post-baseline shadow candidates to queue when
 * a source is activated, honoring BOTH catch-up limits:
 *
 *   - AGE: a candidate whose age reference (trusted publication date, else
 *     first-observed) is strictly before `now - ageDays` is too old → deferred.
 *   - COUNT: of the age-eligible candidates, only the newest `maxCount` are
 *     queued; the remainder are deferred.
 *
 * Candidates are ordered newest-first by age reference, with the sanitized
 * `provisionalKey` (ascending) as a stable tiebreak, so the selection is fully
 * deterministic for a stable input and identical on retry. Older/over-limit
 * candidates stay shadow observations (only an explicit future backfill may
 * reactivate them). Free of DB/network access.
 */
export function selectActivationCatchUp(
  candidates: readonly ShadowCatchUpCandidate[],
  options: { now: Date; limits?: CatchUpLimits },
): ActivationCatchUpDecision {
  const ageDays = options.limits?.ageDays ?? DEFAULT_CATCHUP_AGE_DAYS;
  const maxCount = options.limits?.maxCount ?? DEFAULT_CATCHUP_MAX_COUNT;
  const ageCutoff = new Date(options.now.getTime() - ageDays * DAY_MS);

  // Stable newest-first order: age reference descending, then provisionalKey
  // ascending as a deterministic tiebreak.
  const ordered = [...candidates].sort((a, b) => {
    const dt = ageReference(b).getTime() - ageReference(a).getTime();
    if (dt !== 0) return dt;
    if (a.provisionalKey < b.provisionalKey) return -1;
    if (a.provisionalKey > b.provisionalKey) return 1;
    return 0;
  });

  const queue: string[] = [];
  const deferred: string[] = [];
  for (const candidate of ordered) {
    const tooOld = ageReference(candidate).getTime() < ageCutoff.getTime();
    if (!tooOld && queue.length < maxCount) {
      queue.push(candidate.id);
    } else {
      deferred.push(candidate.id);
    }
  }

  return { queue, deferred, ageCutoff };
}
