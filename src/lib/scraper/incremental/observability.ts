/**
 * PURE discovery-source observability metrics (issue #1089, Phase 1.9).
 *
 * This module contains NO database, network, or clock access: it takes a plain
 * {@link SourceMetricInput} (a metadata-only snapshot assembled by the thin
 * `observability-query.ts` layer) plus an explicit `now` and computes a
 * {@link SourceMetricSummary} — the per-source operational signals the admin UI
 * renders WITHOUT touching the database, mirroring the pure-logic house style of
 * `classify.ts` / `frontier.ts` / `lifecycle.ts`.
 *
 * The governing invariant is upheld structurally: nothing here fetches a body,
 * writes an Article, or enqueues ingest work — it only READS a snapshot and
 * derives numbers, statuses, durations and counts. It NEVER accepts or emits a
 * URL, article body, credential, or any user-private content: every field is a
 * controlled id, count, status, duration, or sanitized category (AC4).
 *
 * The centrepiece is {@link computeSourceMetrics} → {@link deriveOperationalStatus},
 * which collapses the raw signals into ONE {@link OperationalStatus} enum so the
 * UI can distinguish healthy/caught-up, healthy-with-backlog, partial, stalled,
 * and gap-detected sources without inspecting the database directly (AC1).
 */
import {
  CrawlCandidateStatus,
  DiscoveryAutomationPolicy,
  DiscoveryGapState,
  DiscoverySourceHealth,
  DiscoverySourceLifecycleMode,
  DiscoverySourceRole,
} from "@prisma/client";

const M = DiscoverySourceLifecycleMode;
const H = DiscoverySourceHealth;
const G = DiscoveryGapState;
const S = CrawlCandidateStatus;

// ---------------------------------------------------------------------------
// Operational status taxonomy (AC1)
// ---------------------------------------------------------------------------

/**
 * The single derived operational status the admin UI renders as a badge. It
 * collapses lifecycle mode, health, gap state, and the drift signals into one
 * value so the front-end never inspects raw columns.
 *
 *   - `healthy-caught-up`  — HEALTHY and up to date: caught up to the boundary
 *     with no pending work and no drift.
 *   - `healthy-backlog`    — HEALTHY and progressing, but candidates are still
 *     queued/ingesting (expected work in flight, not a problem).
 *   - `partial`            — DEGRADED / a suspected gap / active backoff: an
 *     incomplete-but-progressing run, not proven caught up.
 *   - `stalled`            — needs attention: FAILING/BLOCKED health, or an
 *     ACTIVE source drifting (zero-discovery streak / watermark stall / repeated
 *     failures past threshold).
 *   - `gap-detected`       — a completeness gap has been DETECTED (highest
 *     priority signal; surfaced, never auto-fetched).
 */
export type OperationalStatus =
  | "healthy-caught-up"
  | "healthy-backlog"
  | "partial"
  | "stalled"
  | "gap-detected";

// ---------------------------------------------------------------------------
// Thresholds used purely for STATUS derivation (distinct from degradation)
// ---------------------------------------------------------------------------

/**
 * Thresholds that decide when the derived STATUS flips a running source to
 * `stalled`. These describe how the UI badge is coloured; the separate
 * `degradation.ts` thresholds decide when a source is actually DEMOTED. Kept
 * independent so a source can read `stalled` (a warning) before it crosses the
 * (typically higher) demotion bar.
 */
export type StatusThresholds = {
  /** Zero-discovery streak at/above which an ACTIVE source reads `stalled`. */
  zeroDiscoveryStreak: number;
  /** Watermark stall (ms) at/above which an ACTIVE source reads `stalled`. */
  watermarkStallMs: number;
  /** Consecutive failures at/above which a source reads `stalled`. */
  consecutiveFailures: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default status thresholds (deliberately BELOW the demotion thresholds). */
export const DEFAULT_STATUS_THRESHOLDS: StatusThresholds = {
  zeroDiscoveryStreak: 5,
  watermarkStallMs: 14 * DAY_MS,
  consecutiveFailures: 3,
};

// ---------------------------------------------------------------------------
// Inputs — a metadata-only snapshot (never a URL / body / secret)
// ---------------------------------------------------------------------------

/** Candidate counts keyed by controlled status enum (no identities/URLs). */
export type CandidateStatusCounts = Partial<Record<CrawlCandidateStatus, number>>;

/**
 * The metadata-only source snapshot the pure metrics read. Every field is a
 * controlled enum, count, timestamp, or duration — never a URL/body/secret.
 */
export type SourceStateSnapshot = {
  role: DiscoverySourceRole;
  lifecycleMode: DiscoverySourceLifecycleMode;
  automationPolicy: DiscoveryAutomationPolicy;
  health: DiscoverySourceHealth;
  gapState: DiscoveryGapState;
  gapDetectedAt: Date | null;
  watermarkAt: Date | null;
  baselineCompletedAt: Date | null;
  baselineObservedCount: number;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  activatedAt: Date | null;
  backoffLevel: number;
  backoffUntil: Date | null;
  consecutiveFailures: number;
  consecutiveZeroDiscoveryRuns: number;
  discoveryBudgetPerRun: number | null;
  /** Whether the most recent completed run reached the observable boundary. */
  lastRunCaughtUp?: boolean;
};

/**
 * Optional discovery-volume buckets used to classify a volume anomaly. Both are
 * plain counts derived from `CrawlCandidate.firstObservedAt` distributions (no
 * identities), so the classification stays pure.
 */
export type DiscoveryVolumeBuckets = {
  /** New identities first observed in the most recent 24h window. */
  recentDayCount: number;
  /** Mean new identities/day across the preceding baseline window. */
  baselineDailyMean: number;
};

/** Everything the pure metric computation reads. */
export type SourceMetricInput = {
  now: Date;
  source: SourceStateSnapshot;
  candidateCounts: CandidateStatusCounts;
  /**
   * Publication-to-discovery delays (ms) for recently observed candidates —
   * `firstObservedAt − trustedPublishedAt`. A duration only; no identities.
   */
  publicationToDiscoveryDelaysMs?: readonly number[];
  /** Optional volume buckets for anomaly classification. */
  volume?: DiscoveryVolumeBuckets;
  /** Validator failures counted in the observation window (sanitized category). */
  validatorFailures?: number;
  /** Override the status thresholds (provider-aware); defaults applied otherwise. */
  statusThresholds?: StatusThresholds;
};

// ---------------------------------------------------------------------------
// Output — the computed summary DTO
// ---------------------------------------------------------------------------

/** Percentile rollup of a duration series, in whole seconds. */
export type DelayPercentiles = {
  p50Seconds: number;
  p90Seconds: number;
  maxSeconds: number;
  sampleCount: number;
};

/** A volume anomaly classification (or `unknown` when data is insufficient). */
export type VolumeAnomaly = "none" | "spike" | "drop" | "unknown";

/** The computed, metadata-only per-source metric summary rendered by the UI. */
export type SourceMetricSummary = {
  status: OperationalStatus;
  role: DiscoverySourceRole;
  lifecycleMode: DiscoverySourceLifecycleMode;
  automationPolicy: DiscoveryAutomationPolicy;
  health: DiscoverySourceHealth;
  gapState: DiscoveryGapState;

  /** Consecutive successful runs that discovered zero new identities. */
  zeroDiscoveryStreak: number;
  consecutiveFailures: number;
  backoffLevel: number;
  backoffActive: boolean;

  watermarkAt: Date | null;
  watermarkStallSeconds: number | null;
  lastRunAt: Date | null;
  lastRunAgeSeconds: number | null;
  nextRunAt: Date | null;
  baselineCompletedAt: Date | null;
  baselineObservedCount: number;
  activatedAt: Date | null;
  gapDetectedAt: Date | null;
  gapAgeSeconds: number | null;

  candidateCounts: CandidateStatusCounts;
  totalCandidates: number;
  /** QUEUED + INGESTING: work accepted but not yet ingested. */
  backlogCount: number;
  discoveredCount: number;
  ingestedCount: number;
  rejectedCount: number;
  failedCount: number;
  conflictCount: number;
  /** CONFLICT / total: sanitized rate; null when there are no candidates. */
  conflictRate: number | null;

  publicationToDiscoveryDelay: DelayPercentiles | null;
  volumeAnomaly: VolumeAnomaly;
  discoveryBudgetPerRun: number | null;
  validatorFailures: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ageSeconds(now: Date, at: Date | null): number | null {
  if (at === null) return null;
  return Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
}

function count(counts: CandidateStatusCounts, status: CrawlCandidateStatus): number {
  return counts[status] ?? 0;
}

/** Nearest-rank percentile (whole seconds) over a millisecond duration series. */
function delayPercentiles(delaysMs: readonly number[]): DelayPercentiles | null {
  const clean = delaysMs.filter((ms) => Number.isFinite(ms) && ms >= 0).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const at = (p: number): number => {
    const rank = Math.ceil((p / 100) * clean.length);
    const idx = Math.min(clean.length - 1, Math.max(0, rank - 1));
    return Math.round(clean[idx] / 1000);
  };
  return {
    p50Seconds: at(50),
    p90Seconds: at(90),
    maxSeconds: Math.round(clean[clean.length - 1] / 1000),
    sampleCount: clean.length,
  };
}

/**
 * Classifies discovery volume against the baseline daily mean. A `spike` is more
 * than 3× the baseline mean; a `drop` is a run of new candidates falling below a
 * quarter of the mean; otherwise `none`. Returns `unknown` when there is no
 * meaningful baseline to compare against.
 */
export function classifyVolumeAnomaly(volume: DiscoveryVolumeBuckets | undefined): VolumeAnomaly {
  if (!volume || volume.baselineDailyMean <= 0) return "unknown";
  const ratio = volume.recentDayCount / volume.baselineDailyMean;
  if (ratio >= 3) return "spike";
  if (ratio <= 0.25) return "drop";
  return "none";
}

// ---------------------------------------------------------------------------
// Status derivation (AC1)
// ---------------------------------------------------------------------------

/** True when the source is in a mode where drift signals are meaningful. */
function isRunningMode(mode: DiscoverySourceLifecycleMode): boolean {
  return mode === M.BASELINE || mode === M.SHADOW || mode === M.ACTIVE;
}

/**
 * Derives the single {@link OperationalStatus} from the raw signals, applying a
 * strict precedence so the UI badge is deterministic:
 *
 *   1. `gap-detected` — a DETECTED completeness gap always wins.
 *   2. `stalled`      — FAILING/BLOCKED health, or an ACTIVE source past a drift
 *                       threshold (zero-discovery streak / watermark stall /
 *                       repeated failures).
 *   3. `partial`      — DEGRADED health, a SUSPECTED gap, or active backoff.
 *   4. `healthy-backlog` — HEALTHY with queued/ingesting work in flight.
 *   5. `healthy-caught-up` — HEALTHY, no backlog, no drift.
 *
 * Non-running modes (DISABLED/PAUSED/RETIRED) never read `stalled` from drift —
 * they are operator states — but a DETECTED gap is still surfaced.
 */
export function deriveOperationalStatus(input: {
  lifecycleMode: DiscoverySourceLifecycleMode;
  health: DiscoverySourceHealth;
  gapState: DiscoveryGapState;
  zeroDiscoveryStreak: number;
  watermarkStallSeconds: number | null;
  consecutiveFailures: number;
  backoffActive: boolean;
  backlogCount: number;
  thresholds: StatusThresholds;
}): OperationalStatus {
  const {
    lifecycleMode,
    health,
    gapState,
    zeroDiscoveryStreak,
    watermarkStallSeconds,
    consecutiveFailures,
    backoffActive,
    backlogCount,
    thresholds,
  } = input;

  if (gapState === G.DETECTED) return "gap-detected";

  const hardUnhealthy = health === H.FAILING || health === H.BLOCKED;
  const running = isRunningMode(lifecycleMode);
  const active = lifecycleMode === M.ACTIVE;
  const watermarkStalled =
    watermarkStallSeconds !== null &&
    watermarkStallSeconds * 1000 >= thresholds.watermarkStallMs;
  const drift =
    active &&
    (zeroDiscoveryStreak >= thresholds.zeroDiscoveryStreak || watermarkStalled);
  const failing = running && consecutiveFailures >= thresholds.consecutiveFailures;

  if (hardUnhealthy || drift || failing) return "stalled";

  if (health === H.DEGRADED || gapState === G.SUSPECTED || backoffActive) return "partial";

  if (backlogCount > 0) return "healthy-backlog";

  return "healthy-caught-up";
}

// ---------------------------------------------------------------------------
// Metric computation entry point
// ---------------------------------------------------------------------------

/**
 * Computes the full {@link SourceMetricSummary} from a metadata-only snapshot.
 * PURE and deterministic: identical input + `now` always yields identical output,
 * and no field is ever a URL, body, or secret.
 */
export function computeSourceMetrics(input: SourceMetricInput): SourceMetricSummary {
  const { now, source, candidateCounts } = input;
  const thresholds = input.statusThresholds ?? DEFAULT_STATUS_THRESHOLDS;

  const totalCandidates = Object.values(candidateCounts).reduce(
    (sum, n) => sum + (n ?? 0),
    0,
  );
  const backlogCount = count(candidateCounts, S.QUEUED) + count(candidateCounts, S.INGESTING);
  const discoveredCount = count(candidateCounts, S.DISCOVERED);
  const ingestedCount = count(candidateCounts, S.INGESTED);
  const rejectedCount = count(candidateCounts, S.REJECTED);
  const failedCount = count(candidateCounts, S.FAILED);
  const conflictCount = count(candidateCounts, S.CONFLICT);

  const watermarkStallSeconds = ageSeconds(now, source.watermarkAt);
  const backoffActive =
    source.backoffUntil !== null && source.backoffUntil.getTime() > now.getTime();

  const status = deriveOperationalStatus({
    lifecycleMode: source.lifecycleMode,
    health: source.health,
    gapState: source.gapState,
    zeroDiscoveryStreak: source.consecutiveZeroDiscoveryRuns,
    watermarkStallSeconds,
    consecutiveFailures: source.consecutiveFailures,
    backoffActive,
    backlogCount,
    thresholds,
  });

  return {
    status,
    role: source.role,
    lifecycleMode: source.lifecycleMode,
    automationPolicy: source.automationPolicy,
    health: source.health,
    gapState: source.gapState,

    zeroDiscoveryStreak: source.consecutiveZeroDiscoveryRuns,
    consecutiveFailures: source.consecutiveFailures,
    backoffLevel: source.backoffLevel,
    backoffActive,

    watermarkAt: source.watermarkAt,
    watermarkStallSeconds,
    lastRunAt: source.lastRunAt,
    lastRunAgeSeconds: ageSeconds(now, source.lastRunAt),
    nextRunAt: source.nextRunAt,
    baselineCompletedAt: source.baselineCompletedAt,
    baselineObservedCount: source.baselineObservedCount,
    activatedAt: source.activatedAt,
    gapDetectedAt: source.gapDetectedAt,
    gapAgeSeconds: ageSeconds(now, source.gapDetectedAt),

    candidateCounts,
    totalCandidates,
    backlogCount,
    discoveredCount,
    ingestedCount,
    rejectedCount,
    failedCount,
    conflictCount,
    conflictRate: totalCandidates > 0 ? conflictCount / totalCandidates : null,

    publicationToDiscoveryDelay: delayPercentiles(input.publicationToDiscoveryDelaysMs ?? []),
    volumeAnomaly: classifyVolumeAnomaly(input.volume),
    discoveryBudgetPerRun: source.discoveryBudgetPerRun,
    validatorFailures: input.validatorFailures ?? 0,
  };
}
