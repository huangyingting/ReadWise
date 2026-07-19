/**
 * PURE failure classification + retry scheduling for candidate-based ingestion
 * (#1093, Phase 2.3).
 *
 * The actual body fetch / extraction / Article creation lands in #1095. This
 * module is the pure seam #1095 (or the worker hand-off) calls with a PROVIDED
 * ingest-attempt OUTCOME. It has NO database, network, or wall-clock access —
 * every timing decision takes an explicit `now: Date` — so it is fully
 * fake-clock unit-testable and stays covered by the unit-only coverage gate.
 *
 * It answers two questions deterministically:
 *   1. What kind of failure was this, and what should happen to the candidate/
 *      Job — retry, immediate terminal, or quarantine? ({@link classifyIngestAttempt})
 *   2. If retrying, WHEN is the next attempt runnable? (backoff + jitter, with a
 *      server `Retry-After` overriding the computed backoff.)
 *
 * PRIVACY: reasons are machine codes ONLY. Nothing here accepts, returns, logs,
 * or persists a response body, article text, URL, secret, cookie, or auth detail.
 *
 * GOVERNING INVARIANT: this module never decides to touch a KNOWN Article. It
 * only classifies ingest attempts for candidates with NO Article; the guarded
 * persistence layer (`ingest-recovery.ts`) re-enforces that at write time.
 */
import { jitteredExponentialBackoff } from "@/lib/backoff";

/**
 * Normalized outcome of a single ingest ATTEMPT, supplied by the #1095 fetch/
 * extract pipeline. METADATA ONLY — a status code / discriminant, never a body.
 */
export type IngestAttemptOutcome =
  | { kind: "fetch-timeout" }
  | { kind: "network-error" }
  /** Any non-2xx HTTP status surfaced by the fetch seam; `retryAfterMs` is a parsed `Retry-After`. */
  | { kind: "http-error"; status: number; retryAfterMs?: number }
  /** Extraction produced too little / incomplete prose (may be pre-render or a stale extractor). */
  | { kind: "extraction-incomplete" }
  /** Deterministic quality-gate rejection (same extractor ⇒ same verdict). */
  | { kind: "quality-rejected" }
  /** Explicitly PERMANENT access restriction (paywall / robots deny / policy). */
  | { kind: "access-restricted" };

/** Machine failure reason codes recorded on candidate/Job metadata (never bodies). */
export const INGEST_FAILURE_REASON = {
  FETCH_TIMEOUT: "fetch_timeout",
  NETWORK_ERROR: "network_error",
  HTTP_404_PRE_PROPAGATION: "http_404_pre_propagation",
  HTTP_404_AFTER_GRACE: "http_404_after_grace",
  HTTP_403_TEMPORARY: "http_403_temporary",
  HTTP_429: "http_429",
  HTTP_5XX: "http_5xx",
  HTTP_410_GONE: "http_410_gone",
  HTTP_CLIENT_ERROR: "http_client_error",
  ACCESS_RESTRICTED: "access_restricted",
  EXTRACTION_INCOMPLETE: "extraction_incomplete",
  QUALITY_REJECTED: "quality_rejected",
} as const;

export type IngestFailureReason =
  (typeof INGEST_FAILURE_REASON)[keyof typeof INGEST_FAILURE_REASON];

/**
 * Current extractor/ingest processing version. Bumping this in code and running
 * a reactivation pass ({@link selectReactivationEligible} + `reactivateCandidate`)
 * re-attempts quarantined no-Article extraction/quality failures under the newer
 * extractor without disturbing the prior terminal Job history. It also seeds the
 * initial ingest dedupe-key version; reactivation MUST bump strictly above it.
 */
export const CURRENT_EXTRACTOR_VERSION = 1;

/**
 * Reasons that a bounded extractor-version upgrade may REACTIVATE (a no-Article
 * candidate that failed extraction or quality validation — never a permanent or
 * transient-network failure). See {@link selectReactivationEligible}.
 */
export const REACTIVATABLE_FAILURE_REASONS: ReadonlySet<IngestFailureReason> = new Set([
  INGEST_FAILURE_REASON.EXTRACTION_INCOMPLETE,
  INGEST_FAILURE_REASON.QUALITY_REJECTED,
]);

/** Controlled disposition of an ingest attempt. */
export type IngestDisposition =
  /** Attempts remain and the failure is transient — retry at `nextAttemptAt`. */
  | "retry"
  /** Permanent failure (410 / access-restricted / permanent 4xx) — stop forever. */
  | "terminal"
  /** Exhausted transient OR deterministic reprocessable failure — quarantine. */
  | "quarantine-on-exhaustion";

/** Result of classifying an ingest attempt. Consumed by `ingest-recovery.ts`. */
export type IngestClassification = {
  disposition: IngestDisposition;
  reason: IngestFailureReason;
  /** Server-provided `Retry-After` (ms), when present; overrides computed backoff. */
  retryAfterMs?: number;
  /** Absolute next-attempt time — ONLY set for `disposition === "retry"`. */
  nextAttemptAt?: Date;
};

/** Backoff + grace tuning for {@link classifyIngestAttempt}. */
export type IngestScheduleConfig = {
  /** Total ingest attempts allowed before a transient failure quarantines. */
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** Propagation grace window (ms) from `firstAttemptAt` during which a 404 is transient. */
  propagationGraceMs: number;
  /** Injectable random source for deterministic jitter in tests. Defaults to Math.random. */
  random?: () => number;
};

type FailureCategory = "transient" | "deterministic" | "permanent";

function categorize(
  outcome: IngestAttemptOutcome,
  withinGrace: boolean,
): { category: FailureCategory; reason: IngestFailureReason; retryAfterMs?: number } {
  switch (outcome.kind) {
    case "fetch-timeout":
      return { category: "transient", reason: INGEST_FAILURE_REASON.FETCH_TIMEOUT };
    case "network-error":
      return { category: "transient", reason: INGEST_FAILURE_REASON.NETWORK_ERROR };
    case "extraction-incomplete":
      // Transient (page may still be rendering) but ALSO reactivatable by a
      // newer extractor once it lands in quarantine on exhaustion.
      return { category: "transient", reason: INGEST_FAILURE_REASON.EXTRACTION_INCOMPLETE };
    case "quality-rejected":
      // Deterministic: the same extractor yields the same verdict, so retrying
      // is pointless — quarantine immediately, reactivatable on upgrade.
      return { category: "deterministic", reason: INGEST_FAILURE_REASON.QUALITY_REJECTED };
    case "access-restricted":
      return { category: "permanent", reason: INGEST_FAILURE_REASON.ACCESS_RESTRICTED };
    case "http-error":
      return categorizeHttp(outcome.status, withinGrace, outcome.retryAfterMs);
  }
}

function categorizeHttp(
  status: number,
  withinGrace: boolean,
  retryAfterMs: number | undefined,
): { category: FailureCategory; reason: IngestFailureReason; retryAfterMs?: number } {
  const withRetryAfter = retryAfterMs !== undefined ? { retryAfterMs } : {};
  if (status === 410) {
    return { category: "permanent", reason: INGEST_FAILURE_REASON.HTTP_410_GONE };
  }
  if (status === 404) {
    // Pre-propagation transient WITHIN the grace window; a persistent 404 after
    // grace is a deterministic not-found that quarantines (never re-enqueued).
    return withinGrace
      ? { category: "transient", reason: INGEST_FAILURE_REASON.HTTP_404_PRE_PROPAGATION }
      : { category: "deterministic", reason: INGEST_FAILURE_REASON.HTTP_404_AFTER_GRACE };
  }
  if (status === 429) {
    return { category: "transient", reason: INGEST_FAILURE_REASON.HTTP_429, ...withRetryAfter };
  }
  if (status === 403) {
    // Temporary bot-challenge / edge 403; a PERMANENT access denial is surfaced
    // by the pipeline as the distinct `access-restricted` outcome instead.
    return { category: "transient", reason: INGEST_FAILURE_REASON.HTTP_403_TEMPORARY, ...withRetryAfter };
  }
  if (status >= 500 && status < 600) {
    return { category: "transient", reason: INGEST_FAILURE_REASON.HTTP_5XX, ...withRetryAfter };
  }
  // Any other 4xx (400/401/405/451/…) is a permanent client error.
  return { category: "permanent", reason: INGEST_FAILURE_REASON.HTTP_CLIENT_ERROR };
}

/** True when `now` is still inside the propagation grace window from `firstAttemptAt`. */
export function withinPropagationGrace(
  firstAttemptAt: Date | null,
  now: Date,
  graceMs: number,
): boolean {
  if (graceMs <= 0) return false;
  const start = firstAttemptAt ?? now;
  return now.getTime() - start.getTime() <= graceMs;
}

/**
 * Computes the absolute next-attempt time for a transient retry. A server
 * `Retry-After` (ms) OVERRIDES the computed backoff; otherwise it is
 * `now + jitteredExponentialBackoff(attemptNumber, base, max)` reusing the
 * shared backoff helper (bounded jitter, capped at `maxBackoffMs`).
 */
export function computeNextAttemptAt(params: {
  attemptNumber: number;
  now: Date;
  config: IngestScheduleConfig;
  retryAfterMs?: number;
}): Date {
  const { attemptNumber, now, config, retryAfterMs } = params;
  // A server Retry-After OVERRIDES the computed backoff (the origin knows best);
  // otherwise fall back to shared jittered exponential backoff.
  const delay =
    retryAfterMs !== undefined && retryAfterMs >= 0
      ? retryAfterMs
      : jitteredExponentialBackoff({
          attempt: attemptNumber,
          baseMs: config.baseBackoffMs,
          maxMs: config.maxBackoffMs,
          ...(config.random ? { random: config.random } : {}),
        });
  return new Date(now.getTime() + delay);
}

/**
 * Classifies a PROVIDED ingest-attempt outcome into a controlled disposition +
 * machine reason, and — for a retry — the next runnable time.
 *
 * @param outcome        Normalized outcome from the #1095 fetch/extract pipeline.
 * @param now            Injected clock (fake-clock testable).
 * @param attemptNumber  1-based number of THIS attempt (attempts made so far,
 *                       including the current failing one).
 * @param firstAttemptAt When the first ingest attempt happened (grace anchor);
 *                       null when this IS the first attempt.
 * @param config         Backoff + grace tuning.
 */
export function classifyIngestAttempt(params: {
  outcome: IngestAttemptOutcome;
  now: Date;
  attemptNumber: number;
  firstAttemptAt: Date | null;
  config: IngestScheduleConfig;
}): IngestClassification {
  const { outcome, now, attemptNumber, firstAttemptAt, config } = params;
  const withinGrace = withinPropagationGrace(firstAttemptAt, now, config.propagationGraceMs);
  const { category, reason, retryAfterMs } = categorize(outcome, withinGrace);

  if (category === "permanent") {
    return { disposition: "terminal", reason };
  }

  // Deterministic reprocessable (quality-rejected, 404-after-grace): retrying
  // with the same extractor is pointless — quarantine immediately (reactivatable
  // by an extractor-version upgrade, per REACTIVATABLE_FAILURE_REASONS).
  if (category === "deterministic") {
    return { disposition: "quarantine-on-exhaustion", reason, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  }

  // Transient: retry while attempts remain; quarantine once exhausted.
  const exhausted = attemptNumber >= config.maxAttempts;
  if (exhausted) {
    return { disposition: "quarantine-on-exhaustion", reason, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  }
  const nextAttemptAt = computeNextAttemptAt({ attemptNumber, now, config, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
  return { disposition: "retry", reason, nextAttemptAt, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
}

// ---------------------------------------------------------------------------
// Extractor-version reactivation (pure selection).
// ---------------------------------------------------------------------------

/**
 * Minimal candidate projection needed to decide reactivation eligibility.
 * METADATA ONLY — never a URL or article content.
 */
export type ReactivationCandidate = {
  id: string;
  status: string;
  observedInBaseline: boolean;
  articleId: string | null;
  lastFailureReason: string | null;
  extractorVersion: number | null;
  /** Deterministic tiebreaker for the budget cut (e.g. firstObservedAt ms). */
  orderKey?: number;
};

export type ReactivationSelectionOptions = {
  /** The upgraded extractor version being rolled out. */
  newExtractorVersion: number;
  /** Bounded max candidates to reactivate in this pass. */
  budget: number;
};

/**
 * True when a single candidate is eligible for extractor-version reactivation.
 * Eligible iff it is a QUARANTINED no-Article candidate that failed extraction
 * or quality validation and has NOT already been processed by `newExtractorVersion`.
 *
 * NEVER eligible: any candidate with an Article (saved/deleted), any
 * baseline-observed identity, or any status other than QUARANTINED — which
 * excludes INGESTED, SKIPPED (policy), REJECTED (permanent 410/access),
 * NEEDS_REVIEW, CONFLICT, and DUPLICATE_ALIAS by construction (governing
 * invariant: never revive a known Article, never touch a review/conflict park).
 */
export function isReactivationEligible(
  candidate: ReactivationCandidate,
  newExtractorVersion: number,
): boolean {
  if (candidate.articleId != null) return false;
  if (candidate.observedInBaseline) return false;
  if (candidate.status !== "QUARANTINED") return false;
  if (candidate.lastFailureReason == null) return false;
  if (!REACTIVATABLE_FAILURE_REASONS.has(candidate.lastFailureReason as IngestFailureReason)) {
    return false;
  }
  // Only reactivate when the extractor genuinely advanced past what last ran.
  if (candidate.extractorVersion != null && candidate.extractorVersion >= newExtractorVersion) {
    return false;
  }
  return true;
}

/**
 * Selects the eligible subset for extractor-version reactivation, capped at the
 * bounded `budget`. Deterministic order: `orderKey` ascending (oldest first),
 * then `id` ascending, so a repeated pass with the same input selects the same
 * candidates (restart-safe).
 */
export function selectReactivationEligible(
  candidates: readonly ReactivationCandidate[],
  options: ReactivationSelectionOptions,
): ReactivationCandidate[] {
  const { newExtractorVersion, budget } = options;
  if (budget <= 0) return [];
  const eligible = candidates
    .filter((candidate) => isReactivationEligible(candidate, newExtractorVersion))
    .sort((a, b) => {
      const ak = a.orderKey ?? 0;
      const bk = b.orderKey ?? 0;
      if (ak !== bk) return ak - bk;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  return eligible.slice(0, budget);
}
