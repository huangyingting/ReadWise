/**
 * Privacy test for the fluency-trend analytics event (#813).
 *
 * Verifies that loading the Progress view model emits `fluency_trend_viewed`
 * with ONLY the controlled trend enum, the sample COUNT, and the optional level
 * filter — never any WPM value, article id/title, or other content. All data
 * dependencies are mocked.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let emitted: Array<{ type: string; userId?: string; properties?: Record<string, unknown> }> = [];
let fluencyTrend: Record<string, unknown> = {
  avgWpm: 220,
  trend: "improving",
  sampleCount: 8,
  levelFilter: null,
  categoryFilter: null,
};

before(() => {
  mock.module("@/lib/analytics/learner", {
    namedExports: {
      getLearnerAnalytics: async () => ({
        totalCompleted: 5,
        totalInProgress: 0,
        totalSavedWords: 0,
        totalQuizAttempts: 0,
        averageQuizScore: null,
        currentStreak: 0,
        longestStreak: 0,
        quizScoreTrend: [],
        completionsByWeek: [],
        wordsByWeek: [],
        completedByLevel: {},
      }),
    },
  });
  mock.module("@/lib/engagement", {
    namedExports: {
      getActivityHeatmap: async () => [],
      getReadingSpeedStats: async () => ({ averageWpm: 220, recentWpm: 230, sessionCount: 8 }),
      getFluencyTrend: async () => fluencyTrend,
    },
  });
  mock.module("@/lib/progress-helpers", {
    namedExports: {
      getLevelHistory: async () => [],
      getCurrentLevel: async () => null,
    },
  });
  mock.module("@/lib/analytics/events", {
    namedExports: {
      ANALYTICS_EVENT_TYPES: { fluencyTrendViewed: "fluency_trend_viewed" },
      recordEvent: async (input: {
        type: string;
        userId?: string;
        properties?: Record<string, unknown>;
      }) => {
        emitted.push(input);
      },
    },
  });
});

beforeEach(() => {
  emitted = [];
  fluencyTrend = {
    avgWpm: 220,
    trend: "improving",
    sampleCount: 8,
    levelFilter: null,
    categoryFilter: null,
  };
});

test("fluency_trend_viewed emits ONLY { trend, sampleCount, levelFilter } — no WPM/content", async () => {
  const { loadProgressViewModel } = await import("@/app/(app)/progress/view-model");
  await loadProgressViewModel("u1");

  const event = emitted.find((e) => e.type === "fluency_trend_viewed");
  assert.ok(event, "fluency_trend_viewed must be emitted");
  assert.deepEqual(event!.properties, {
    trend: "improving",
    sampleCount: 8,
    levelFilter: null,
  });
  // Defense: no WPM / article fields leak through.
  const keys = Object.keys(event!.properties ?? {});
  for (const banned of ["avgWpm", "wpm", "articleId", "title", "categoryFilter"]) {
    assert.equal(keys.includes(banned), false, `must not include ${banned}`);
  }
});
