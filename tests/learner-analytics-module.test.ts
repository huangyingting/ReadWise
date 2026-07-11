process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let postgres = false;
let progressStats: Array<{ completed: boolean; _count: { id: number } }> = [];
let completedRows: Array<{ completedAt: Date | null }> = [];
let savedWordsTotal = 0;
let recentWords: Array<{ createdAt: Date }> = [];
let quizAggregate = { _count: { id: 0 }, _avg: { scorePct: null as number | null } };
let recentQuizAttempts: Array<{ scorePct: number }> = [];
let levelDistribution: Array<{ difficulty: string | null; count: bigint | number }> = [];
let streakSummary = { currentStreak: 0, longestStreak: 0 };
let queryRawCalls = 0;

before(() => {
  mock.module("@/lib/db-utils", {
    namedExports: {
      isPostgresDatabase: () => postgres,
    },
  });

  mock.module("@/lib/engagement", {
    namedExports: {
      getStreakSummary: async () => streakSummary,
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        readingProgress: {
          groupBy: async () => progressStats,
          findMany: async ({ where }: { where: { completed?: boolean } }) => {
            if (where?.completed) return completedRows;
            return [];
          },
        },
        savedWord: {
          count: async () => savedWordsTotal,
          findMany: async () => recentWords,
        },
        quizAttempt: {
          aggregate: async () => quizAggregate,
          findMany: async () => recentQuizAttempts,
        },
        $queryRaw: async () => {
          queryRawCalls++;
          return levelDistribution;
        },
      },
    },
  });
});

beforeEach(() => {
  postgres = false;
  progressStats = [
    { completed: true, _count: { id: 4 } },
    { completed: false, _count: { id: 2 } },
  ];
  completedRows = [
    { completedAt: new Date(Date.now() - 2 * 86_400_000) },
    { completedAt: null },
  ];
  savedWordsTotal = 6;
  recentWords = [{ createdAt: new Date(Date.now() - 3 * 86_400_000) }];
  quizAggregate = { _count: { id: 3 }, _avg: { scorePct: 83.2 } };
  recentQuizAttempts = [{ scorePct: 60 }, { scorePct: 80 }, { scorePct: 90 }];
  levelDistribution = [
    { difficulty: "B2", count: 2 },
    { difficulty: null, count: 1 },
  ];
  streakSummary = { currentStreak: 5, longestStreak: 9 };
  queryRawCalls = 0;
});

test("learner analytics aggregates totals, trends, and CEFR distribution on sqlite", async () => {
  const { getLearnerAnalytics } = await import("@/lib/analytics/learner");

  const analytics = await getLearnerAnalytics("user-1");

  assert.equal(analytics.totalCompleted, 4);
  assert.equal(analytics.totalInProgress, 2);
  assert.equal(analytics.totalSavedWords, 6);
  assert.equal(analytics.totalQuizAttempts, 3);
  assert.equal(analytics.averageQuizScore, 83);
  assert.deepEqual(analytics.quizScoreTrend, [90, 80, 60]);

  assert.equal(analytics.completedByLevel.length, 2);
  assert.deepEqual(analytics.completedByLevel, [
    { level: "B2", count: 2 },
    { level: "Unknown", count: 1 },
  ]);

  assert.equal(analytics.completionsByWeek.length, 12);
  assert.equal(analytics.wordsByWeek.length, 12);
  assert.equal(analytics.currentStreak, 5);
  assert.equal(analytics.longestStreak, 9);
  assert.equal(queryRawCalls, 1);
});

test("learner analytics supports postgres count conversion and empty quiz aggregate", async () => {
  const { getLearnerAnalytics } = await import("@/lib/analytics/learner");

  postgres = true;
  quizAggregate = { _count: { id: 0 }, _avg: { scorePct: null } };
  recentQuizAttempts = [];
  levelDistribution = [{ difficulty: "A2", count: 3n }];

  const analytics = await getLearnerAnalytics("user-2");

  assert.equal(analytics.totalQuizAttempts, 0);
  assert.equal(analytics.averageQuizScore, null);
  assert.deepEqual(analytics.quizScoreTrend, []);
  assert.deepEqual(analytics.completedByLevel, [{ level: "A2", count: 3 }]);
  assert.equal(queryRawCalls, 1);
});
