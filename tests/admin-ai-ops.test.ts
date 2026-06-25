/**
 * AI cost & content-ops aggregation tests (RW-054). `@/lib/prisma` and
 * `@/lib/ai-usage-summary` are mocked; the helpers' prisma surface + the job
 * dashboard are injected so no real DB is touched. Verifies the cost overview
 * ranks features by spend + flags high-fallback features, and that the
 * content-ops overview rolls up per-step status counts and groups problem
 * articles.
 */
process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
  mock.module("@/lib/ai-usage-summary", {
    namedExports: {
      summarizeAiUsage: async () => ({
        total: {
          count: 10,
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          estimatedCostUsd: 1.23,
          fallbackCount: 2,
          cacheHitCount: 3,
        },
        byFeature: [
          { key: "translation", count: 6, promptTokens: 60, completionTokens: 30, totalTokens: 90, estimatedCostUsd: 0.9 },
          { key: "quiz", count: 4, promptTokens: 40, completionTokens: 20, totalTokens: 60, estimatedCostUsd: 0.33 },
        ],
        byModel: [],
        byStatus: [],
        range: { since: null, until: null },
      }),
    },
  });
});

test("getAiCostOverview ranks features by cost and flags high fallback", async () => {
  const { getAiCostOverview } = await import("@/lib/processing/admin-ops");

  const client = {
    aiInvocation: {
      aggregate: async () => ({ _avg: { latencyMs: 210.7 }, _max: { latencyMs: 900 } }),
      groupBy: async (args: { by: string[]; where?: { fallback?: boolean } }) => {
        const field = args.by[0];
        const fallback = args.where?.fallback === true;
        if (field === "feature" && fallback) {
          // 3 of translation's 6 calls fell back → 50%.
          return [{ feature: "translation", _count: { _all: 3 } }];
        }
        if (field === "userId" && !fallback) {
          return [
            { userId: "u1", _count: { _all: 5 }, _sum: { promptTokens: 50, completionTokens: 25, totalTokens: 75, estimatedCostUsd: 0.8 } },
            { userId: null, _count: { _all: 2 }, _sum: { promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCostUsd: 0.1 } },
          ];
        }
        if (field === "userId" && fallback) {
          return [{ userId: "u1", _count: { _all: 1 } }];
        }
        if (field === "articleId") {
          return [
            { articleId: "a1", _count: { _all: 4 }, _sum: { promptTokens: 40, completionTokens: 20, totalTokens: 60, estimatedCostUsd: 0.6 } },
            { articleId: null, _count: { _all: 1 }, _sum: { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCostUsd: 0.01 } },
          ];
        }
        return [];
      },
    },
  };

  const overview = await getAiCostOverview({ hours: 168, client: client as never });

  // Features ranked by cost (translation 0.9 > quiz 0.33).
  assert.equal(overview.byFeatureCost[0].key, "translation");
  assert.equal(overview.byFeatureCost[0].fallbackCount, 3);
  assert.equal(overview.byFeatureCost[0].fallbackRatePct, 50);

  // High-fallback feature surfaced.
  assert.equal(overview.highFallbackFeatures[0].key, "translation");

  // Latency rounded.
  assert.equal(overview.latency.avgMs, 211);
  assert.equal(overview.latency.maxMs, 900);

  // Top users + articles (anonymous article id dropped).
  assert.equal(overview.topUsers[0].key, "u1");
  assert.equal(overview.topArticles[0].key, "a1");
  assert.ok(!overview.topArticles.some((a) => a.key === "—"));
});

test("getContentOpsOverview rolls up step status counts + problem articles", async () => {
  const { getContentOpsOverview } = await import("@/lib/processing/admin-ops");

  const client = {
    articleProcessingStep: {
      groupBy: async () => [
        { step: "tags", status: "generated", _count: { _all: 5 } },
        { step: "tags", status: "failed", _count: { _all: 1 } },
        { step: "quiz", status: "fallback", _count: { _all: 2 } },
      ],
      findMany: async () => [
        {
          articleId: "a1",
          step: "tags",
          status: "failed",
          lastError: "boom",
          updatedAt: new Date("2026-06-20T00:00:00Z"),
          article: { title: "Article One", status: "published" },
        },
        {
          articleId: "a1",
          step: "quiz",
          status: "fallback",
          lastError: null,
          updatedAt: new Date("2026-06-19T00:00:00Z"),
          article: { title: "Article One", status: "published" },
        },
      ],
    },
  };

  const jobDashboard = {
    byStatus: { PENDING: 3, FAILED: 1 },
    byType: {},
    total: 4,
    stuck: 0,
    recentFailures: [],
    deadLetter: [],
  };

  const ops = await getContentOpsOverview({
    client: client as never,
    jobDashboard,
  });

  assert.equal(ops.totals.generated, 5);
  assert.equal(ops.totals.failed, 1);
  assert.equal(ops.totals.fallback, 2);

  const tags = ops.steps.find((s) => s.step === "tags")!;
  assert.equal(tags.counts.generated, 5);
  assert.equal(tags.counts.failed, 1);
  assert.equal(tags.counts.total, 6);

  // a1 grouped with both a failed + a fallback step.
  assert.equal(ops.problemArticles.length, 1);
  assert.equal(ops.problemArticles[0].articleId, "a1");
  assert.equal(ops.problemArticles[0].failed, 1);
  assert.equal(ops.problemArticles[0].fallback, 1);
  assert.equal(ops.problemArticles[0].title, "Article One");

  assert.equal(ops.jobs.total, 4);
});
