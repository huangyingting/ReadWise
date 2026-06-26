/**
 * Tests for @/lib/pronunciation lib helpers: recordPronunciationAttempt,
 * getPronunciationHistory (M16 Pronunciation Practice).
 *
 * Mocks: @/lib/prisma.
 * No real DB, network, or Azure Speech SDK touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let createdAttempt: Record<string, unknown> | null = null;
let maxPronScore: number | null = null;
let findManyRows: Record<string, unknown>[] = [];
let aggResult: {
  _count: { id: number };
  _avg: { pronScore: number | null };
  _max: { pronScore: number | null };
} = { _count: { id: 0 }, _avg: { pronScore: null }, _max: { pronScore: null } };

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        pronunciationAttempt: {
          create: async (args: { data: Record<string, unknown> }) => {
            const d = args.data;
            createdAttempt = {
              id: "pa-1",
              referenceText: d.referenceText,
              accuracyScore: d.accuracyScore,
              fluencyScore: d.fluencyScore,
              completenessScore: d.completenessScore,
              pronScore: d.pronScore,
              articleId: d.articleId ?? null,
              createdAt: new Date("2026-01-01T00:00:00Z"),
            };
            return createdAttempt;
          },
          aggregate: async (args: Record<string, unknown>) => {
            if ("_count" in args) {
              return {
                _count: { id: aggResult._count.id },
                _avg: { pronScore: aggResult._avg.pronScore },
                _max: { pronScore: aggResult._max.pronScore },
              };
            }
            return { _max: { pronScore: maxPronScore } };
          },
          findMany: async () => findManyRows,
        },
      },
    },
  });
});

beforeEach(() => {
  createdAttempt = null;
  maxPronScore = null;
  findManyRows = [];
  aggResult = { _count: { id: 0 }, _avg: { pronScore: null }, _max: { pronScore: null } };
});

// ---------------------------------------------------------------------------
// recordPronunciationAttempt
// ---------------------------------------------------------------------------

describe("recordPronunciationAttempt", () => {
  test("records attempt and returns best pronScore", async () => {
    maxPronScore = 85;
    const { recordPronunciationAttempt } = await import("@/lib/pronunciation");
    const result = await recordPronunciationAttempt("user-1", {
      referenceText: "The quick brown fox",
      accuracyScore: 80,
      fluencyScore: 75,
      completenessScore: 90,
      pronScore: 85,
    });
    assert.ok(result.attempt.id);
    assert.equal(result.attempt.accuracyScore, 80);
    assert.equal(result.attempt.pronScore, 85);
    assert.equal(result.best, 85);
  });

  test("stores optional articleId", async () => {
    maxPronScore = 70;
    const { recordPronunciationAttempt } = await import("@/lib/pronunciation");
    const result = await recordPronunciationAttempt("user-1", {
      referenceText: "Hello world",
      accuracyScore: 70,
      fluencyScore: 65,
      completenessScore: 80,
      pronScore: 70,
      articleId: "article-42",
    });
    assert.equal(result.attempt.articleId, "article-42");
  });

  test("throws on empty referenceText", async () => {
    const { recordPronunciationAttempt } = await import("@/lib/pronunciation");
    await assert.rejects(
      () =>
        recordPronunciationAttempt("user-1", {
          referenceText: "   ",
          accuracyScore: 80,
          fluencyScore: 75,
          completenessScore: 90,
          pronScore: 85,
        }),
      /referenceText/,
    );
  });

  test("throws on score > 100", async () => {
    const { recordPronunciationAttempt } = await import("@/lib/pronunciation");
    await assert.rejects(
      () =>
        recordPronunciationAttempt("user-1", {
          referenceText: "Hello",
          accuracyScore: 150,
          fluencyScore: 75,
          completenessScore: 90,
          pronScore: 85,
        }),
      /accuracyScore/,
    );
  });

  test("throws on negative score", async () => {
    const { recordPronunciationAttempt } = await import("@/lib/pronunciation");
    await assert.rejects(
      () =>
        recordPronunciationAttempt("user-1", {
          referenceText: "Hello",
          accuracyScore: 80,
          fluencyScore: -5,
          completenessScore: 90,
          pronScore: 85,
        }),
      /fluencyScore/,
    );
  });

  test("throws on non-integer score", async () => {
    const { recordPronunciationAttempt } = await import("@/lib/pronunciation");
    await assert.rejects(
      () =>
        recordPronunciationAttempt("user-1", {
          referenceText: "Hello",
          accuracyScore: 80,
          fluencyScore: 75,
          completenessScore: 90,
          pronScore: 85.5,
        }),
      /pronScore/,
    );
  });
});

// ---------------------------------------------------------------------------
// getPronunciationHistory
// ---------------------------------------------------------------------------

describe("getPronunciationHistory", () => {
  test("returns summary with attempts and stats", async () => {
    findManyRows = [
      {
        id: "pa-1",
        referenceText: "Hello world",
        accuracyScore: 80,
        fluencyScore: 70,
        completenessScore: 90,
        pronScore: 80,
        articleId: null,
        createdAt: new Date("2026-01-01"),
      },
    ];
    aggResult = { _count: { id: 1 }, _avg: { pronScore: 80 }, _max: { pronScore: 80 } };
    const { getPronunciationHistory } = await import("@/lib/pronunciation");
    const history = await getPronunciationHistory("user-1");
    assert.equal(history.attemptCount, 1);
    assert.equal(history.bestPronScore, 80);
    assert.equal(history.averageScore, 80);
    assert.equal(history.attempts.length, 1);
    assert.equal(history.attempts[0].id, "pa-1");
  });

  test("returns nulls for best/average when no attempts", async () => {
    findManyRows = [];
    aggResult = { _count: { id: 0 }, _avg: { pronScore: null }, _max: { pronScore: null } };
    const { getPronunciationHistory } = await import("@/lib/pronunciation");
    const history = await getPronunciationHistory("user-1");
    assert.equal(history.attemptCount, 0);
    assert.equal(history.bestPronScore, null);
    assert.equal(history.averageScore, null);
    assert.deepEqual(history.attempts, []);
  });

  test("rounds averageScore", async () => {
    findManyRows = [];
    aggResult = { _count: { id: 3 }, _avg: { pronScore: 76.67 }, _max: { pronScore: 85 } };
    const { getPronunciationHistory } = await import("@/lib/pronunciation");
    const history = await getPronunciationHistory("user-1");
    assert.equal(history.averageScore, 77);
    assert.equal(history.bestPronScore, 85);
  });
});
