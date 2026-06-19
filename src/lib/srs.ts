/**
 * SM-2 spaced repetition engine (US-M6). Pure functions — no Prisma or I/O.
 *
 * Grade → SM-2 quality mapping:
 *   again → reset (repetitions=0, interval=1 day, EF slightly penalised)
 *   hard  → q=3  (progression continues, EF decreases)
 *   good  → q=4  (normal SM-2 progression, EF stable)
 *   easy  → q=5  (bonus progression, EF increases)
 */

export type Grade = "again" | "hard" | "good" | "easy";

/** SM-2 quality assigned to each grade (used for EF updates). */
const QUALITY: Record<Exclude<Grade, "again">, number> = {
  hard: 3,
  good: 4,
  easy: 5,
};

/** Minimum ease factor — SM-2 spec says >= 1.3. */
const MIN_EF = 1.3;

export interface SrsState {
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
}

export interface SrsResult extends SrsState {
  dueAt: Date;
}

/**
 * Computes the next SRS schedule from the current state and the user's grade.
 *
 * SM-2 interval rules:
 *   repetitions == 0 → 1 day
 *   repetitions == 1 → 6 days
 *   repetitions >= 2 → round(prevInterval × EF)
 *
 * Again bypasses the standard path: resets repetitions+interval and reduces EF.
 * Hard applies a 0.6× (60%) multiplier, capping the interval below the normal EF-based value.
 */
export function applySm2(state: SrsState, grade: Grade): SrsResult {
  let { intervalDays, easeFactor, repetitions } = state;

  if (grade === "again") {
    repetitions = 0;
    intervalDays = 1;
    easeFactor = Math.max(MIN_EF, easeFactor - 0.2);
  } else {
    const q = QUALITY[grade];
    // EF' = EF + (0.1 − (5−q)×(0.08 + (5−q)×0.02))
    easeFactor = Math.max(
      MIN_EF,
      easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
    );

    // Advance interval per SM-2 schedule
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }

    // Hard caps growth so a weak card doesn't jump too far
    if (grade === "hard") {
      intervalDays = Math.max(1, Math.round(intervalDays * 0.6));
    }

    repetitions += 1;
  }

  const dueAt = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);
  return { intervalDays, easeFactor, repetitions, dueAt };
}
