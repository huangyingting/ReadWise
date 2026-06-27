/**
 * Pure reading-speed functions for the engagement subsystem.
 *
 * WPM computation and trend helpers are free of any DB dependency so they
 * can be tested without mocking Prisma.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum active reading time (ms) before a WPM value is meaningful. */
export const MIN_ACTIVE_TIME_MS = 5_000; // 5 seconds

/**
 * Hard cap on the active reading time we store per article (accumulated).
 * Values above this are clamped on the client and server to prevent runaway
 * accumulation (e.g. a tab left open all night).
 */
export const MAX_ACTIVE_TIME_MS = 3_600_000; // 1 hour

/** Lower plausibility bound for a WPM reading. */
export const MIN_WPM = 50;

/** Upper plausibility bound for a WPM reading. */
export const MAX_WPM = 600;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Clamps `ms` to [0, MAX_ACTIVE_TIME_MS].
 * Call this on the client before sending and on the server after receiving.
 */
export function clampActiveTime(ms: number): number {
  return Math.min(Math.max(ms, 0), MAX_ACTIVE_TIME_MS);
}

/**
 * Computes words-per-minute from an article's word count and the user's
 * active reading time for that article.
 *
 * Returns null when:
 *  - `wordCount` is null / ≤ 0 (article word count unavailable)
 *  - `activeTimeMs` < MIN_ACTIVE_TIME_MS (too short to be reliable; a 2-second
 *    blip would otherwise yield 50 000+ WPM)
 *
 * The raw result is clamped to [MIN_WPM, MAX_WPM] so an implausible word
 * count or a very long article with a short active session can't produce an
 * absurd speed.
 */
export function computeWpm(
  wordCount: number | null | undefined,
  activeTimeMs: number,
): number | null {
  if (!wordCount || wordCount <= 0) return null;
  if (activeTimeMs < MIN_ACTIVE_TIME_MS) return null;
  const minutes = activeTimeMs / 60_000;
  const raw = wordCount / minutes;
  return Math.round(Math.min(MAX_WPM, Math.max(MIN_WPM, raw)));
}

// ---------------------------------------------------------------------------
// Trend helpers
// ---------------------------------------------------------------------------

/** A reading session record used for trend computation. */
export interface SpeedRecord {
  /** Article word count. */
  wordCount: number;
  /** Accumulated active reading time for this article (ms). */
  timeSpentMs: number;
}

/**
 * Computes an average WPM and a "recent" WPM from historical records.
 *
 *  - `averageWpm`: mean across ALL valid sessions (sessions where both
 *    `wordCount` and a long-enough `timeSpentMs` yield a computable WPM).
 *  - `recentWpm`: mean of the last `recentCount` valid sessions; indicates
 *    whether the reader's speed is improving or regressing.
 *  - Both are null when there are no valid sessions.
 */
export function computeWpmTrend(
  records: SpeedRecord[],
  recentCount = 5,
): { averageWpm: number | null; recentWpm: number | null } {
  const valid: number[] = [];
  for (const r of records) {
    const wpm = computeWpm(r.wordCount, r.timeSpentMs);
    if (wpm !== null) valid.push(wpm);
  }
  if (valid.length === 0) {
    return { averageWpm: null, recentWpm: null };
  }
  const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  const recent = valid.slice(-recentCount);
  const recentWpm =
    recent.length > 0
      ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length)
      : null;
  return { averageWpm: avg, recentWpm };
}

// ---------------------------------------------------------------------------
// Fluency trend (#813)
// ---------------------------------------------------------------------------

/** Controlled fluency-trend outcomes shown on the Progress fluency panel. */
export type FluencyTrendValue =
  | "improving"
  | "stable"
  | "declining"
  | "insufficient_data";

/**
 * On-demand reading-fluency trend for the Progress page. Computed from existing
 * source rows — NEVER persisted or cached server-side. Carries an aggregate
 * average WPM, the controlled trend enum, the sample count, and the filters the
 * caller applied (so the UI can label the panel). It deliberately omits any
 * per-article WPM values or article ids.
 */
export interface FluencyTrend {
  /** Mean WPM across all valid samples; null when < MIN_FLUENCY_SAMPLES. */
  avgWpm: number | null;
  trend: FluencyTrendValue;
  sampleCount: number;
  /** CEFR level filter applied (null when unfiltered). */
  levelFilter: string | null;
  /** Topic/category filter applied (null when unfiltered). */
  categoryFilter: string | null;
}

/**
 * Minimum number of valid WPM samples required before a trend (other than
 * `insufficient_data`) is reported. Below this the data is too sparse to draw a
 * non-punitive, meaningful conclusion.
 */
export const MIN_FLUENCY_SAMPLES = 3;

/** Window size (each side) for the recent-vs-prior moving-average comparison. */
export const FLUENCY_WINDOW = 5;

/**
 * Relative change (fraction) at/above which a trend is called improving or
 * declining; smaller absolute changes are reported as `stable`. Kept small so
 * ordinary day-to-day variation does not flip the label.
 */
export const FLUENCY_TREND_DELTA = 0.05; // 5%

/**
 * Pure, deterministic fluency-trend classifier (no AI, no I/O).
 *
 * Given an ordered (oldest → newest) list of reading sessions, computes the
 * mean WPM of the most recent {@link FLUENCY_WINDOW} VALID sessions against the
 * mean of the prior {@link FLUENCY_WINDOW} VALID sessions:
 *
 *   - `insufficient_data` — fewer than {@link MIN_FLUENCY_SAMPLES} valid
 *     sessions (a session is invalid when its `timeSpentMs` is zero / too short
 *     or its `wordCount` is missing, i.e. {@link computeWpm} returns null).
 *   - `improving` — recent mean exceeds prior mean by ≥ {@link FLUENCY_TREND_DELTA}.
 *   - `declining` — recent mean is below prior mean by ≥ {@link FLUENCY_TREND_DELTA}.
 *   - `stable` — within the delta band, or not enough history for two windows.
 *
 * `avgWpm` is the mean across ALL valid samples, or null when there are fewer
 * than {@link MIN_FLUENCY_SAMPLES}. The decline framing is intentionally
 * non-punitive in copy (slower reads often mean harder content).
 */
export function computeFluencyTrend(
  records: SpeedRecord[],
  filters: { level?: string | null; category?: string | null } = {},
): FluencyTrend {
  const levelFilter = filters.level ?? null;
  const categoryFilter = filters.category ?? null;

  const valid: number[] = [];
  for (const r of records) {
    const wpm = computeWpm(r.wordCount, r.timeSpentMs);
    if (wpm !== null) valid.push(wpm);
  }

  const sampleCount = valid.length;
  if (sampleCount < MIN_FLUENCY_SAMPLES) {
    return {
      avgWpm: null,
      trend: "insufficient_data",
      sampleCount,
      levelFilter,
      categoryFilter,
    };
  }

  const avgWpm = Math.round(valid.reduce((a, b) => a + b, 0) / sampleCount);

  // Need two non-empty windows to compare; otherwise call it stable.
  const recent = valid.slice(-FLUENCY_WINDOW);
  const prior = valid.slice(-(FLUENCY_WINDOW * 2), -FLUENCY_WINDOW);
  if (prior.length === 0) {
    return { avgWpm, trend: "stable", sampleCount, levelFilter, categoryFilter };
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const recentMean = mean(recent);
  const priorMean = mean(prior);
  const delta = (recentMean - priorMean) / priorMean;

  let trend: FluencyTrendValue;
  if (delta >= FLUENCY_TREND_DELTA) trend = "improving";
  else if (delta <= -FLUENCY_TREND_DELTA) trend = "declining";
  else trend = "stable";

  return { avgWpm, trend, sampleCount, levelFilter, categoryFilter };
}
