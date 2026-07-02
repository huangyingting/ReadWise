process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let pickOptions: unknown[] = [];
let existingSession: Record<string, unknown> | null = null;
let createdSession: Record<string, unknown> | null = null;
let createError: Error | null = null;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        readingProgress: { findFirst: async () => null },
        placementResult: { findUnique: async () => ({ recommendedLevel: "B1" }) },
      },
    },
  });
  mock.module("@/lib/article-library", {
    namedExports: { publicListableArticleWhere: () => ({ visibility: "public" }) },
  });
  mock.module("@/lib/recommendations/picks", {
    namedExports: {
      listScoredPicksPage: async (_userId: string, options: unknown) => {
        pickOptions.push(options);
        return { articles: [{ id: "a1" }, { id: "a2" }, { id: "a3" }] };
      },
    },
  });
  mock.module("@/lib/leveling/cefr-primitives", {
    namedExports: { isDifficultyLevel: (level: unknown) => level === "B1" },
  });
  mock.module("@/lib/engagement/series", {
    namedExports: {
      resolveNextSeriesArticle: async () => {
        throw new Error("series unavailable");
      },
    },
  });
  mock.module("@/lib/engagement/today-session/repository", {
    namedExports: {
      getTodaySession: async () => existingSession,
      createTodaySession: async () => {
        if (createError) throw createError;
        return createdSession;
      },
    },
  });
  mock.module("@/lib/engagement/today-session/local-date", {
    namedExports: { resolveLocalDate: async () => ({ localDate: "2026-07-01", timezone: "UTC" }) },
  });
  mock.module("@/lib/engagement/today-session/target-words", {
    namedExports: { selectTargetWordIds: async () => ({ targetSavedWordIds: [], reviewTargetCount: 0 }) },
  });
  mock.module("@/lib/engagement/today-session/analytics", {
    namedExports: {
      emitTodaySessionGenerated: async () => {},
      emitTodayNoCandidate: async () => {},
    },
  });
});

beforeEach(() => {
  pickOptions = [];
  existingSession = null;
  createdSession = {
    id: "today-1",
    generationReasonCode: "picks_primary",
  };
  createError = null;
});

test("buildTodayPlan ignores series resolver failures and still uses placement-aware picks", async () => {
  const { buildTodayPlan } = await import("@/lib/engagement/today-session/generator");

  const plan = await buildTodayPlan({ userId: "user-1", now: new Date("2026-07-01T12:00:00Z") });

  assert.equal(plan.primaryArticleId, "a1");
  assert.deepEqual(plan.backupArticleIds, ["a2", "a3"]);
  assert.equal(plan.generationReasonCode, "picks_primary");
  assert.equal((pickOptions[0] as { placementLevel: string }).placementLevel, "B1");
  assert.equal((pickOptions[0] as { extraCandidateIds?: string[] }).extraCandidateIds, undefined);
});

test("getOrCreateTodaySession resolves missing timezone and rethrows non-unique create failures", async () => {
  const { getOrCreateTodaySession } = await import("@/lib/engagement/today-session/generator");
  createError = new Error("database offline");

  await assert.rejects(
    getOrCreateTodaySession({
      userId: "user-1",
      localDate: "2026-07-01",
      now: new Date("2026-07-01T12:00:00Z"),
    }),
    /database offline/,
  );
});
