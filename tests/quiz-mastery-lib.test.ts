/**
 * Tests for quiz mastery lib functions (M14).
 *
 * Mocks: @/lib/prisma, @/lib/quiz.
 * No real DB or network touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let articleExists = true;

let createdAttempt: Record<string, unknown> | null = null;
let aggregateResult: { _count: { id: number }; _avg: { scorePct: number | null } } = {
  _count: { id: 0 },
  _avg: { scorePct: null },
};
let maxAggResult: { _max: { scorePct: number | null } } = { _max: { scorePct: null } };
let findManyRows: Record<string, unknown>[] = [];
let groupByRows: { articleId: string; _count: { articleId: number } }[] = [];

// ---------------------------------------------------------------------------
// Module mocks (registered once before any imports of the modules under test)
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findUnique: async () => (articleExists ? { id: "a1" } : null),
          findFirst: async () => (articleExists ? { id: "a1" } : null),
        },
        quizAttempt: {
          create: async (args: {
            data: Record<string, unknown>;
            select: Record<string, unknown>;
          }) => {
            const data = args.data as {
              userId: string;
              articleId: string;
              correctCount: number;
              totalQuestions: number;
              scorePct: number;
            };
            createdAttempt = {
              id: "attempt-1",
              correctCount: data.correctCount,
              totalQuestions: data.totalQuestions,
              scorePct: data.scorePct,
              completedAt: new Date("2026-01-01T00:00:00Z"),
            };
            return createdAttempt;
          },
          aggregate: async (args: { _max?: unknown; _count?: unknown; _avg?: unknown }) => {
            if (args._max) return maxAggResult;
            return aggregateResult;
          },
          findMany: async () => findManyRows,
          groupBy: async () => groupByRows,
        },
      },
    },
  });
});

beforeEach(() => {
  articleExists = true;
  createdAttempt = null;
  aggregateResult = { _count: { id: 0 }, _avg: { scorePct: null } };
  maxAggResult = { _max: { scorePct: null } };
  findManyRows = [];
  groupByRows = [];
});

// ---------------------------------------------------------------------------
// recordQuizAttempt
// ---------------------------------------------------------------------------

describe("recordQuizAttempt", () => {
  test("computes scorePct correctly and returns best", async () => {
    maxAggResult = { _max: { scorePct: 80 } };
    const { recordQuizAttempt } = await import("@/lib/learning/quiz-mastery");
    const { attempt, best } = await recordQuizAttempt("user-1", "a1", 4, 5);
    assert.equal(attempt.scorePct, 80);
    assert.equal(attempt.correctCount, 4);
    assert.equal(attempt.totalQuestions, 5);
    assert.equal(best, 80);
  });

  test("0 correct → scorePct 0", async () => {
    maxAggResult = { _max: { scorePct: 0 } };
    const { recordQuizAttempt } = await import("@/lib/learning/quiz-mastery");
    const { attempt } = await recordQuizAttempt("user-1", "a1", 0, 5);
    assert.equal(attempt.scorePct, 0);
  });

  test("all correct → scorePct 100", async () => {
    maxAggResult = { _max: { scorePct: 100 } };
    const { recordQuizAttempt } = await import("@/lib/learning/quiz-mastery");
    const { attempt } = await recordQuizAttempt("user-1", "a1", 5, 5);
    assert.equal(attempt.scorePct, 100);
  });

  test("throws on totalQuestions = 0", async () => {
    const { recordQuizAttempt } = await import("@/lib/learning/quiz-mastery");
    await assert.rejects(() => recordQuizAttempt("user-1", "a1", 0, 0), /totalQuestions/);
  });

  test("throws when correctCount > totalQuestions", async () => {
    const { recordQuizAttempt } = await import("@/lib/learning/quiz-mastery");
    await assert.rejects(() => recordQuizAttempt("user-1", "a1", 6, 5), /correctCount/);
  });

  test("throws on negative correctCount", async () => {
    const { recordQuizAttempt } = await import("@/lib/learning/quiz-mastery");
    await assert.rejects(() => recordQuizAttempt("user-1", "a1", -1, 5), /correctCount/);
  });
});

// ---------------------------------------------------------------------------
// getArticleQuizHistory
// ---------------------------------------------------------------------------

describe("getArticleQuizHistory", () => {
  test("returns attempts newest-first, computes best/last/count", async () => {
    findManyRows = [
      { id: "a2", correctCount: 4, totalQuestions: 5, scorePct: 80, completedAt: new Date("2026-02-01") },
      { id: "a1", correctCount: 3, totalQuestions: 5, scorePct: 60, completedAt: new Date("2026-01-01") },
    ];
    const { getArticleQuizHistory } = await import("@/lib/learning/quiz-mastery");
    const history = await getArticleQuizHistory("user-1", "a1");
    assert.equal(history.attemptCount, 2);
    assert.equal(history.best, 80);
    assert.equal(history.lastScore, 80);
    assert.equal(history.attempts[0].id, "a2");
  });

  test("returns nulls when no attempts exist", async () => {
    findManyRows = [];
    const { getArticleQuizHistory } = await import("@/lib/learning/quiz-mastery");
    const history = await getArticleQuizHistory("user-1", "no-attempts");
    assert.equal(history.best, null);
    assert.equal(history.lastScore, null);
    assert.equal(history.attemptCount, 0);
    assert.deepEqual(history.attempts, []);
  });
});

// ---------------------------------------------------------------------------
// getQuizMastery
// ---------------------------------------------------------------------------

describe("getQuizMastery", () => {
  test("aggregates correctly", async () => {
    aggregateResult = { _count: { id: 5 }, _avg: { scorePct: 74.6 } };
    groupByRows = [
      { articleId: "a1", _count: { articleId: 3 } },
      { articleId: "a2", _count: { articleId: 2 } },
    ];
    findManyRows = [
      { completedAt: new Date("2026-01-03"), scorePct: 70 },
      { completedAt: new Date("2026-01-02"), scorePct: 80 },
      { completedAt: new Date("2026-01-01"), scorePct: 60 },
    ];
    const { getQuizMastery } = await import("@/lib/learning/quiz-mastery");
    const mastery = await getQuizMastery("user-1");
    assert.equal(mastery.totalAttempts, 5);
    assert.equal(mastery.articlesQuizzed, 2);
    assert.equal(mastery.averageScore, 75);
    assert.equal(mastery.recentTrend.length, 3);
    assert.equal(mastery.recentTrend[0].scorePct, 60);
    assert.equal(mastery.recentTrend[2].scorePct, 70);
  });

  test("returns null averageScore when no attempts", async () => {
    aggregateResult = { _count: { id: 0 }, _avg: { scorePct: null } };
    groupByRows = [];
    findManyRows = [];
    const { getQuizMastery } = await import("@/lib/learning/quiz-mastery");
    const mastery = await getQuizMastery("user-1");
    assert.equal(mastery.totalAttempts, 0);
    assert.equal(mastery.articlesQuizzed, 0);
    assert.equal(mastery.averageScore, null);
    assert.deepEqual(mastery.recentTrend, []);
  });
});
