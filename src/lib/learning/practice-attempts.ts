/**
 * Practice-attempt shared helpers (REF-051).
 *
 * Provides score validation, count-to-percentage computation, an idempotent
 * attempt helper, and a shared TrendPoint type used by quiz, pronunciation,
 * and future practice types.
 *
 * All exports are pure or dependency-injected — no direct Prisma import,
 * so grading/validation unit tests can import this module without a DB.
 */

// ---------------------------------------------------------------------------
// Score validation
// ---------------------------------------------------------------------------

/**
 * Validates that a score is a 0–100 integer.
 * Throws with the field name so callers can map the error to a 400 response.
 */
export function validateBoundedScore(score: number, name: string): void {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error(`${name} must be an integer between 0 and 100`);
  }
}

/**
 * Validates that correctCount and totalQuestions form a sensible ratio:
 * totalQuestions > 0 and 0 <= correctCount <= totalQuestions.
 */
export function validateCountScore(
  correctCount: number,
  totalQuestions: number,
): void {
  if (
    !Number.isInteger(totalQuestions) ||
    totalQuestions <= 0 ||
    !Number.isInteger(correctCount) ||
    correctCount < 0 ||
    correctCount > totalQuestions
  ) {
    throw new Error(
      "correctCount must be 0–totalQuestions and totalQuestions must be > 0",
    );
  }
}

/** Returns a 0–100 integer percentage derived from correct/total counts. */
export function computeCountScorePct(
  correctCount: number,
  totalQuestions: number,
): number {
  return Math.round((correctCount / totalQuestions) * 100);
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** A single data point for a sparkline / trend chart (oldest→newest). */
export type TrendPoint = {
  completedAt: Date;
  scorePct: number;
};

// ---------------------------------------------------------------------------
// Idempotent attempt helper
// ---------------------------------------------------------------------------

/**
 * Idempotent attempt recording for offline-queue replay (RW-042).
 *
 * When a `clientMutationId` is supplied, checks for an existing record first
 * so a duplicate delivery returns the original row rather than double-
 * recording. A concurrent race condition (two requests inserting at the same
 * time) is handled via the optional `isUniqueConstraintViolation` predicate:
 * if `create` throws a uniqueness error, a final lookup retrieves the winner.
 *
 * Injectable: `find` and `create` are caller-supplied so this helper has no
 * Prisma dependency and is unit-testable with plain stubs.
 */
export async function findOrCreateIdempotent<T>(opts: {
  clientMutationId: string | null;
  find: (id: string) => Promise<T | null>;
  create: () => Promise<T>;
  isUniqueConstraintViolation?: (err: unknown) => boolean;
}): Promise<{ record: T; created: boolean }> {
  const { clientMutationId, find, create, isUniqueConstraintViolation } = opts;

  if (clientMutationId) {
    const existing = await find(clientMutationId);
    if (existing) return { record: existing, created: false };
  }

  try {
    const record = await create();
    return { record, created: true };
  } catch (err) {
    if (clientMutationId && isUniqueConstraintViolation?.(err)) {
      const winner = await find(clientMutationId);
      if (winner) return { record: winner, created: false };
    }
    throw err;
  }
}
