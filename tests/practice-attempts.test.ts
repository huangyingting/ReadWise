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

type IdRecord = { id: string };

// ---------------------------------------------------------------------------
// validateBoundedScore
// ---------------------------------------------------------------------------

for (const { name, value, field } of [
  { name: "0", value: 0, field: "score" },
  { name: "100", value: 100, field: "score" },
  { name: "mid-range integer", value: 75, field: "pronScore" },
] as const) {
  test(`validateBoundedScore accepts ${name}`, () => {
    assert.doesNotThrow(() => validateBoundedScore(value, field));
  });
}

for (const { name, value, field, expected } of [
  { name: "negative", value: -1, field: "fluencyScore", expected: /fluencyScore/ },
  { name: "> 100", value: 101, field: "accuracyScore", expected: /accuracyScore/ },
  { name: "non-integer", value: 85.5, field: "pronScore", expected: /pronScore/ },
  { name: "NaN", value: NaN, field: "score", expected: /score/ },
] as const) {
  test(`validateBoundedScore throws on ${name}`, () => {
    assert.throws(() => validateBoundedScore(value, field), expected);
  });
}

// ---------------------------------------------------------------------------
// validateCountScore
// ---------------------------------------------------------------------------

for (const { name, correctCount, totalQuestions } of [
  { name: "valid counts", correctCount: 3, totalQuestions: 5 },
  { name: "0 correct out of >0 total", correctCount: 0, totalQuestions: 5 },
  { name: "all correct (count == total)", correctCount: 5, totalQuestions: 5 },
] as const) {
  test(`validateCountScore accepts ${name}`, () => {
    assert.doesNotThrow(() => validateCountScore(correctCount, totalQuestions));
  });
}

for (const { name, correctCount, totalQuestions, expected } of [
  { name: "when totalQuestions is 0", correctCount: 0, totalQuestions: 0, expected: /totalQuestions/ },
  { name: "when totalQuestions is negative", correctCount: 0, totalQuestions: -1, expected: /totalQuestions/ },
  { name: "when correctCount > totalQuestions", correctCount: 6, totalQuestions: 5, expected: /correctCount/ },
  { name: "when correctCount is negative", correctCount: -1, totalQuestions: 5, expected: /correctCount/ },
  { name: "on non-integer totalQuestions", correctCount: 3, totalQuestions: 4.5, expected: /totalQuestions/ },
  { name: "on non-integer correctCount", correctCount: 2.5, totalQuestions: 5, expected: /correctCount/ },
] as const) {
  test(`validateCountScore throws ${name}`, () => {
    assert.throws(() => validateCountScore(correctCount, totalQuestions), expected);
  });
}

// ---------------------------------------------------------------------------
// computeCountScorePct
// ---------------------------------------------------------------------------

for (const { name, correctCount, totalQuestions, expected } of [
  { name: "rounds 4/5 to 80", correctCount: 4, totalQuestions: 5, expected: 80 },
  { name: "computes 0/5 as 0", correctCount: 0, totalQuestions: 5, expected: 0 },
  { name: "computes 5/5 as 100", correctCount: 5, totalQuestions: 5, expected: 100 },
  { name: "rounds 2/3 to 67", correctCount: 2, totalQuestions: 3, expected: 67 },
  { name: "rounds 1/3 to 33", correctCount: 1, totalQuestions: 3, expected: 33 },
] as const) {
  test(`computeCountScorePct ${name}`, () => {
    assert.equal(computeCountScorePct(correctCount, totalQuestions), expected);
  });
}

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
  const existing: IdRecord = { id: "existing-1" };
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
