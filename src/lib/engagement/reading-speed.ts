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
