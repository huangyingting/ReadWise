/**
 * Tests for the shared practice-attempt helpers (REF-051).
 *
 * All helpers are pure or dependency-injected — no Prisma import.
 * This satisfies the acceptance check: "Pure grading tests import no Prisma."
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateBoundedScore,
  validateCountScore,
  computeCountScorePct,
  findOrCreateIdempotent,
} from "@/lib/learning/practice-attempts";

// ---------------------------------------------------------------------------
// validateBoundedScore
// ---------------------------------------------------------------------------

test("validateBoundedScore accepts 0", () => {
  assert.doesNotThrow(() => validateBoundedScore(0, "score"));
});

test("validateBoundedScore accepts 100", () => {
  assert.doesNotThrow(() => validateBoundedScore(100, "score"));
});

test("validateBoundedScore accepts mid-range integer", () => {
  assert.doesNotThrow(() => validateBoundedScore(75, "pronScore"));
});

test("validateBoundedScore throws on negative", () => {
  assert.throws(() => validateBoundedScore(-1, "fluencyScore"), /fluencyScore/);
});

test("validateBoundedScore throws on > 100", () => {
  assert.throws(() => validateBoundedScore(101, "accuracyScore"), /accuracyScore/);
});

test("validateBoundedScore throws on non-integer", () => {
  assert.throws(() => validateBoundedScore(85.5, "pronScore"), /pronScore/);
});

test("validateBoundedScore throws on NaN", () => {
  assert.throws(() => validateBoundedScore(NaN, "score"), /score/);
});

// ---------------------------------------------------------------------------
// validateCountScore
// ---------------------------------------------------------------------------

test("validateCountScore accepts valid counts", () => {
  assert.doesNotThrow(() => validateCountScore(3, 5));
});

test("validateCountScore accepts 0 correct out of >0 total", () => {
  assert.doesNotThrow(() => validateCountScore(0, 5));
});

test("validateCountScore accepts all correct (count == total)", () => {
  assert.doesNotThrow(() => validateCountScore(5, 5));
});

test("validateCountScore throws when totalQuestions is 0", () => {
  assert.throws(() => validateCountScore(0, 0), /totalQuestions/);
});

test("validateCountScore throws when totalQuestions is negative", () => {
  assert.throws(() => validateCountScore(0, -1), /totalQuestions/);
});

test("validateCountScore throws when correctCount > totalQuestions", () => {
  assert.throws(() => validateCountScore(6, 5), /correctCount/);
});

test("validateCountScore throws when correctCount is negative", () => {
  assert.throws(() => validateCountScore(-1, 5), /correctCount/);
});

test("validateCountScore throws on non-integer totalQuestions", () => {
  assert.throws(() => validateCountScore(3, 4.5), /totalQuestions/);
});

test("validateCountScore throws on non-integer correctCount", () => {
  assert.throws(() => validateCountScore(2.5, 5), /correctCount/);
});

// ---------------------------------------------------------------------------
// computeCountScorePct
// ---------------------------------------------------------------------------

test("computeCountScorePct rounds 4/5 to 80", () => {
  assert.equal(computeCountScorePct(4, 5), 80);
});

test("computeCountScorePct computes 0/5 as 0", () => {
  assert.equal(computeCountScorePct(0, 5), 0);
});

test("computeCountScorePct computes 5/5 as 100", () => {
  assert.equal(computeCountScorePct(5, 5), 100);
});

test("computeCountScorePct rounds 2/3 to 67", () => {
  assert.equal(computeCountScorePct(2, 3), 67); // Math.round(66.67)
});

test("computeCountScorePct rounds 1/3 to 33", () => {
  assert.equal(computeCountScorePct(1, 3), 33); // Math.round(33.33)
});

// ---------------------------------------------------------------------------
// findOrCreateIdempotent
// ---------------------------------------------------------------------------

test("findOrCreateIdempotent calls create when no clientMutationId", async () => {
  let createCalled = false;
  const { record, created } = await findOrCreateIdempotent({
    clientMutationId: null,
    find: async () => null,
    create: async () => {
      createCalled = true;
      return { id: "new-1" };
    },
  });
  assert.equal(createCalled, true);
  assert.equal(created, true);
  assert.deepEqual(record, { id: "new-1" });
});

test("findOrCreateIdempotent returns existing record without calling create", async () => {
  let createCalled = false;
  const existing = { id: "existing-1" };
  const { record, created } = await findOrCreateIdempotent({
    clientMutationId: "mut-abc",
    find: async () => existing,
    create: async () => {
      createCalled = true;
      return { id: "new-2" };
    },
  });
  assert.equal(createCalled, false);
  assert.equal(created, false);
  assert.deepEqual(record, existing);
});

test("findOrCreateIdempotent calls create when find returns null", async () => {
  const { record, created } = await findOrCreateIdempotent({
    clientMutationId: "mut-xyz",
    find: async () => null,
    create: async () => ({ id: "new-3" }),
  });
  assert.equal(created, true);
  assert.deepEqual(record, { id: "new-3" });
});

test("findOrCreateIdempotent recovers from unique constraint race via find", async () => {
  const winner = { id: "winner-1" };
  let findCallCount = 0;
  const { record, created } = await findOrCreateIdempotent({
    clientMutationId: "mut-race",
    find: async () => {
      findCallCount++;
      // First call (idempotency check): not found yet; second call (race recovery): found.
      return findCallCount >= 2 ? winner : null;
    },
    create: async () => {
      throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
    },
    isUniqueConstraintViolation: (err) =>
      err instanceof Error && (err as NodeJS.ErrnoException).code === "P2002",
  });
  assert.equal(created, false);
  assert.deepEqual(record, winner);
  assert.equal(findCallCount, 2); // initial check + race recovery
});

test("findOrCreateIdempotent re-throws when error is not a unique constraint violation", async () => {
  await assert.rejects(
    () =>
      findOrCreateIdempotent({
        clientMutationId: "mut-err",
        find: async () => null,
        create: async () => {
          throw new Error("DB connection lost");
        },
        isUniqueConstraintViolation: () => false,
      }),
    /DB connection lost/,
  );
});

test("findOrCreateIdempotent re-throws non-unique errors even with clientMutationId", async () => {
  await assert.rejects(
    () =>
      findOrCreateIdempotent({
        clientMutationId: "mut-boom",
        find: async () => null,
        create: async () => {
          throw new Error("Unexpected DB error");
        },
        // No isUniqueConstraintViolation → error always re-thrown
      }),
    /Unexpected DB error/,
  );
});

test("findOrCreateIdempotent does not call find when clientMutationId is null", async () => {
  let findCalled = false;
  await findOrCreateIdempotent({
    clientMutationId: null,
    find: async () => {
      findCalled = true;
      return null;
    },
    create: async () => ({ id: "x" }),
  });
  assert.equal(findCalled, false);
});
