/**
 * Today generator placement wiring tests (#806).
 *
 * Verifies the generator reads `PlacementResult.recommendedLevel` and passes it
 * as a `placementLevel` override to the Picks feed, and that it falls back to
 * the existing (no-override) behaviour when the learner has no placement row.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let placementRow: { recommendedLevel: string } | null = null;
let pickCalls: Array<Record<string, unknown>> = [];

before(() => {
  mock.module("@/lib/article-library", {
    namedExports: { publicListableArticleWhere: () => ({}) },
  });

  mock.module("@/lib/recommendations/picks", {
    namedExports: {
      listScoredPicksPage: async (_userId: string, opts: Record<string, unknown>) => {
        pickCalls.push(opts);
        return {
          articles: [{ id: "p1" }, { id: "p2" }],
          hasMore: false,
          reasons: {},
          scored: {},
        };
      },
    },
  });

  mock.module("@/lib/engagement/today-session/target-words", {
    namedExports: {
      selectTargetWordIds: async () => ({ targetSavedWordIds: [], reviewTargetCount: 0 }),
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        placementResult: {
          findUnique: async () => placementRow,
        },
        readingProgress: {
          findFirst: async () => null, // no resume candidate → Picks path
        },
      },
    },
  });
});

beforeEach(() => {
  placementRow = null;
  pickCalls = [];
});

const NOW = new Date("2026-06-27T12:00:00Z");

test("generator passes PlacementResult.recommendedLevel as the placement override", async () => {
  placementRow = { recommendedLevel: "B2" };
  const { buildTodayPlan } = await import("@/lib/engagement/today-session/generator");
  const plan = await buildTodayPlan({ userId: "u1", now: NOW });

  assert.equal(plan.source, "picks");
  assert.ok(pickCalls.length >= 1);
  assert.equal(pickCalls[0].placementLevel, "B2");
});

test("generator falls back (no override) when there is no PlacementResult row", async () => {
  placementRow = null;
  const { buildTodayPlan } = await import("@/lib/engagement/today-session/generator");
  await buildTodayPlan({ userId: "u1", now: NOW });

  assert.ok(pickCalls.length >= 1);
  // null override → context keeps its existing adaptive/profile level signal.
  assert.equal(pickCalls[0].placementLevel, null);
});

test("generator ignores an invalid stored recommendedLevel (treated as no override)", async () => {
  placementRow = { recommendedLevel: "not-a-level" };
  const { buildTodayPlan } = await import("@/lib/engagement/today-session/generator");
  await buildTodayPlan({ userId: "u1", now: NOW });

  assert.equal(pickCalls[0].placementLevel, null);
});
