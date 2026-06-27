/**
 * Today generator — curated series candidate injection (#813).
 *
 * Verifies that an active series enrollment injects the resolved, ACCESS-CHECKED
 * series article into the Picks scoring as an additional candidate, that a
 * PRIVATE series article never becomes a Today candidate (it is skipped and the
 * next accessible one is injected), and that generation falls back to standard
 * scoring when there is no enrollment.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let pickOpts: Record<string, unknown> = {};
let enrollment: Record<string, unknown> | null = null;
let accessibleIds: Set<string> = new Set();

const NOW = new Date("2026-06-27T12:00:00Z");

before(() => {
  mock.module("@/lib/article-library", {
    namedExports: {
      publicListableArticleWhere: () => ({}),
    },
  });
  mock.module("@/lib/article-library/policy", {
    namedExports: {
      getPublicListableArticleById: async (id: string) =>
        accessibleIds.has(id) ? { id } : null,
    },
  });
  mock.module("@/lib/recommendations/picks", {
    namedExports: {
      listScoredPicksPage: async (_userId: string, opts: Record<string, unknown>) => {
        pickOpts = opts;
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
        readingProgress: { findFirst: async () => null }, // no resume → Picks path
        placementResult: { findUnique: async () => null },
        seriesEnrollment: {
          findFirst: async () => enrollment,
          findUnique: async () => enrollment,
          update: async () => ({}),
        },
        savedWord: { findMany: async () => [] },
      },
    },
  });
});

beforeEach(() => {
  pickOpts = {};
  enrollment = null;
  accessibleIds = new Set();
});

test("injects the resolved series article as an extra Picks candidate", async () => {
  enrollment = {
    id: "e1",
    seriesId: "s1",
    nextIndex: 0,
    series: { id: "s1", status: "active", public: true, articleIds: ["a-series"] },
  };
  accessibleIds = new Set(["a-series"]);

  const { buildTodayPlan } = await import("@/lib/engagement/today-session/generator");
  await buildTodayPlan({ userId: "u1", now: NOW });

  assert.deepEqual(pickOpts.extraCandidateIds, ["a-series"]);
});

test("a PRIVATE series article is never injected; the next accessible one is", async () => {
  enrollment = {
    id: "e1",
    seriesId: "s1",
    nextIndex: 0,
    series: { id: "s1", status: "active", public: true, articleIds: ["a-priv", "a-pub"] },
  };
  accessibleIds = new Set(["a-pub"]); // a-priv is not public-listable

  const { buildTodayPlan } = await import("@/lib/engagement/today-session/generator");
  await buildTodayPlan({ userId: "u1", now: NOW });

  assert.deepEqual(pickOpts.extraCandidateIds, ["a-pub"]);
  assert.ok(
    !(pickOpts.extraCandidateIds as string[]).includes("a-priv"),
    "private series article must never surface as a Today candidate",
  );
});

test("no enrollment → standard scoring with no extra series candidate", async () => {
  enrollment = null;
  const { buildTodayPlan } = await import("@/lib/engagement/today-session/generator");
  await buildTodayPlan({ userId: "u1", now: NOW });
  assert.equal(pickOpts.extraCandidateIds, undefined);
});
