/**
 * AI budgets / quotas (RW-022) tests. No real DB/network: prisma and the AI
 * provider are mocked, and the budget counters use the in-memory fallback (the
 * shared store is disabled under NODE_ENV=test). Verifies:
 *   - per-user / per-feature / global quotas block at their limits,
 *   - interactive over-quota throws ApiError(429) while background skips (no throw),
 *   - quotas disabled (env unset) => always allowed,
 *   - enforcement is wired into chatCompleteWithMeta (interactive throw, bg null),
 *   - getAiBudgetStatus aggregates usage vs limits,
 *   - the admin usage route is admin-gated and returns budget + usage.
 */
process.env.LOG_LEVEL = "error"; // silence request + blocked warnings

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { enableAi, disableAi } from "./helpers";

// ---- mutable mock state -----------------------------------------------------
let aggregateResult: unknown;
let countResult = 0;
const groupByResults: Record<string, unknown[]> = { feature: [], model: [], status: [] };

// Admin-auth toggle for the route test.
let adminAuth: () => Promise<unknown> = async () => ({
  session: { user: { id: "admin-1", role: "Admin" } },
});

function zeroAggregate() {
  return {
    _count: { _all: 0 },
    _sum: { promptTokens: null, completionTokens: null, totalTokens: null, estimatedCostUsd: null },
  };
}

before(() => {
  aggregateResult = zeroAggregate();
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () => ({ session: { user: { id: "u1", role: "Reader" } } }),
      requireCapabilityApi: async () => adminAuth(),
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        aiInvocation: {
          create: async () => ({ id: "rec-1" }),
          aggregate: async () => aggregateResult,
          count: async () => countResult,
          groupBy: async (args: { by: string[] }) => groupByResults[args.by[0]] ?? [],
        },
        rateLimitCounter: {
          upsert: async () => ({ count: 1 }),
          deleteMany: async () => ({ count: 0 }),
        },
        auditLog: { create: async () => ({}) },
      },
    },
  });
});

beforeEach(async () => {
  countResult = 0;
  aggregateResult = zeroAggregate();
  groupByResults.feature = [];
  groupByResults.model = [];
  groupByResults.status = [];
  adminAuth = async () => ({ session: { user: { id: "admin-1", role: "Admin" } } });
  disableAi();
  // Clear all AI_QUOTA_* knobs so each test starts with quotas disabled.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("AI_QUOTA_")) delete process.env[key];
  }
  const { resetAiBudget } = await import("@/lib/ai/budget");
  resetAiBudget();
});

let seq = 0;
function uid(label: string): string {
  return `${label}-${++seq}`;
}

// ---- per-user quota ---------------------------------------------------------

test("per-user interactive quota blocks after N calls", async () => {
  process.env.AI_QUOTA_USER_DAILY = "2";
  const { checkAiBudget } = await import("@/lib/ai/budget");
  const userId = uid("user");
  const feature = "translation";
  assert.equal((await checkAiBudget({ feature, userId, kind: "interactive" })).allowed, true);
  assert.equal((await checkAiBudget({ feature, userId, kind: "interactive" })).allowed, true);
  const blocked = await checkAiBudget({ feature, userId, kind: "interactive" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.scope, "user");
  assert.equal(blocked.limit, 2);
});

test("per-user quota is independent across users", async () => {
  process.env.AI_QUOTA_USER_DAILY = "1";
  const { checkAiBudget } = await import("@/lib/ai/budget");
  const a = uid("user");
  const b = uid("user");
  await checkAiBudget({ feature: "quiz", userId: a, kind: "interactive" }); // fills a
  assert.equal((await checkAiBudget({ feature: "quiz", userId: a, kind: "interactive" })).allowed, false);
  // A different user is unaffected.
  assert.equal((await checkAiBudget({ feature: "quiz", userId: b, kind: "interactive" })).allowed, true);
});

// ---- per-feature quota ------------------------------------------------------

test("per-feature quota is independent of other features", async () => {
  process.env.AI_QUOTA_FEATURE_DEFAULT_DAILY = "1";
  const { checkAiBudget } = await import("@/lib/ai/budget");
  const alpha = uid("alpha");
  const beta = uid("beta");
  assert.equal((await checkAiBudget({ feature: alpha, kind: "interactive" })).allowed, true);
  const blocked = await checkAiBudget({ feature: alpha, kind: "interactive" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.scope, "feature");
  // A different feature has its own counter.
  assert.equal((await checkAiBudget({ feature: beta, kind: "interactive" })).allowed, true);
});

test("AI_QUOTA_FEATURE_<FEATURE>_DAILY overrides the default", async () => {
  process.env.AI_QUOTA_FEATURE_DEFAULT_DAILY = "1";
  process.env.AI_QUOTA_FEATURE_TRANSLATION_DAILY = "3";
  const { checkAiBudget } = await import("@/lib/ai/budget");
  // translation gets the higher override (3), not the default (1).
  for (let i = 0; i < 3; i++) {
    assert.equal((await checkAiBudget({ feature: "translation", kind: "interactive" })).allowed, true);
  }
  assert.equal((await checkAiBudget({ feature: "translation", kind: "interactive" })).allowed, false);
});

// ---- global quota -----------------------------------------------------------

test("global interactive quota blocks across users", async () => {
  process.env.AI_QUOTA_GLOBAL_DAILY = "2";
  const { checkAiBudget } = await import("@/lib/ai/budget");
  assert.equal((await checkAiBudget({ feature: "tags", userId: uid("u"), kind: "interactive" })).allowed, true);
  assert.equal((await checkAiBudget({ feature: "tags", userId: uid("u"), kind: "interactive" })).allowed, true);
  const blocked = await checkAiBudget({ feature: "tags", userId: uid("u"), kind: "interactive" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.scope, "global");
});

test("background quota uses the global-background budget", async () => {
  process.env.AI_QUOTA_BACKGROUND_DAILY = "1";
  process.env.AI_QUOTA_GLOBAL_DAILY = "100"; // interactive budget must not affect bg
  const { checkAiBudget } = await import("@/lib/ai/budget");
  assert.equal((await checkAiBudget({ feature: "tags", kind: "background" })).allowed, true);
  const blocked = await checkAiBudget({ feature: "tags", kind: "background" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.scope, "global-background");
});

// ---- interactive throws vs background skips ---------------------------------

test("assertAiQuota throws ApiError(429) while checkAiBudget returns a decision", async () => {
  process.env.AI_QUOTA_FEATURE_DEFAULT_DAILY = "1";
  const { assertAiQuota, checkAiBudget } = await import("@/lib/ai/budget");
  const { ApiError } = await import("@/lib/api-handler");
  const feature = uid("shared");
  // Fill the (shared) feature budget.
  assert.equal((await checkAiBudget({ feature, kind: "interactive" })).allowed, true);
  // Interactive over-quota throws a 429.
  let thrown: unknown;
  try {
    await assertAiQuota({ feature, kind: "interactive" });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof ApiError, "interactive must throw ApiError");
  assert.equal((thrown as InstanceType<typeof ApiError>).status, 429);
  // Background over-quota returns a non-throwing decision (skip).
  const decision = await checkAiBudget({ feature, kind: "background" });
  assert.equal(decision.allowed, false);
});

// ---- quotas disabled --------------------------------------------------------

test("quotas disabled (env unset) => always allowed and never throws", async () => {
  const { checkAiBudget, assertAiQuota } = await import("@/lib/ai/budget");
  const userId = uid("user");
  for (let i = 0; i < 50; i++) {
    const d = await checkAiBudget({ feature: "translation", userId, kind: "interactive" });
    assert.equal(d.allowed, true);
  }
  await assert.doesNotReject(() => assertAiQuota({ feature: "translation", userId, kind: "interactive" }));
});

test("a zero/negative limit is treated as unlimited", async () => {
  process.env.AI_QUOTA_USER_DAILY = "0";
  process.env.AI_QUOTA_GLOBAL_DAILY = "-5";
  const { checkAiBudget } = await import("@/lib/ai/budget");
  const userId = uid("user");
  for (let i = 0; i < 10; i++) {
    assert.equal((await checkAiBudget({ feature: "quiz", userId, kind: "interactive" })).allowed, true);
  }
});

// ---- ambient background context ---------------------------------------------

test("runWithAiContext makes nested checks default to background", async () => {
  process.env.AI_QUOTA_BACKGROUND_DAILY = "1";
  const { checkAiBudget, runWithAiContext } = await import("@/lib/ai/budget");
  await runWithAiContext({ kind: "background" }, async () => {
    assert.equal((await checkAiBudget({ feature: "tags" })).allowed, true);
    const blocked = await checkAiBudget({ feature: "tags" });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.scope, "global-background");
  });
});

// ---- integration via chatCompleteWithMeta -----------------------------------

function mockOkFetch(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        model: "gpt-test",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
}

test("chatCompleteWithMeta throws 429 on interactive over-quota", async (t) => {
  enableAi();
  process.env.AI_QUOTA_FEATURE_INTTEST_DAILY = "1";
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    disableAi();
    delete process.env.AI_QUOTA_FEATURE_INTTEST_DAILY;
  });
  globalThis.fetch = mockOkFetch();

  const { chatCompleteWithMeta } = await import("@/lib/ai");
  const { ApiError } = await import("@/lib/api-handler");
  const first = await chatCompleteWithMeta([{ role: "user", content: "x" }], { feature: "inttest" });
  assert.ok(first, "first interactive call should succeed");
  let thrown: unknown;
  try {
    await chatCompleteWithMeta([{ role: "user", content: "x" }], { feature: "inttest" });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof ApiError, "second interactive call must throw");
  assert.equal((thrown as InstanceType<typeof ApiError>).status, 429);
});

test("chatCompleteWithMeta returns null (skips) on background over-quota", async (t) => {
  enableAi();
  process.env.AI_QUOTA_BACKGROUND_DAILY = "1";
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    disableAi();
  });
  globalThis.fetch = mockOkFetch();

  const { chatCompleteWithMeta } = await import("@/lib/ai");
  const first = await chatCompleteWithMeta([{ role: "user", content: "x" }], {
    feature: "bgtest",
    kind: "background",
  });
  assert.ok(first, "first background call should succeed");
  const second = await chatCompleteWithMeta([{ role: "user", content: "x" }], {
    feature: "bgtest",
    kind: "background",
  });
  assert.equal(second, null, "second background call must skip gracefully (null), not throw");
});

// ---- getAiBudgetStatus (admin reporting) ------------------------------------

test("getAiBudgetStatus aggregates ledger usage vs configured limits", async () => {
  process.env.AI_QUOTA_USER_DAILY = "10";
  process.env.AI_QUOTA_GLOBAL_DAILY = "100";
  process.env.AI_QUOTA_BACKGROUND_DAILY = "50";
  process.env.AI_QUOTA_FEATURE_TRANSLATION_DAILY = "40";
  aggregateResult = {
    _count: { _all: 40 },
    _sum: { promptTokens: 400, completionTokens: 200, totalTokens: 600, estimatedCostUsd: 1.5 },
  };
  groupByResults.feature = [
    { feature: "translation", _count: { _all: 30 }, _sum: { promptTokens: 300, completionTokens: 150, totalTokens: 450, estimatedCostUsd: 1.2 } },
    { feature: "quiz", _count: { _all: 10 }, _sum: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUsd: 0.3 } },
  ];
  const { getAiBudgetStatus } = await import("@/lib/ai/budget");
  const status = await getAiBudgetStatus();
  assert.equal(status.totalUsed, 40);
  assert.equal(status.estimatedCostUsd, 1.5);
  assert.equal(status.limits.userDaily, 10);
  assert.equal(status.limits.backgroundDaily, 50);
  assert.equal(status.global.interactive.limit, 100);
  assert.equal(status.global.interactive.used, 40);
  assert.equal(status.global.interactive.remaining, 60);
  assert.equal(status.global.background.remaining, 10);
  const translation = status.features.find((f) => f.feature === "translation");
  assert.ok(translation);
  assert.equal(translation.used, 30);
  assert.equal(translation.limit, 40);
  assert.equal(translation.remaining, 10);
  const quiz = status.features.find((f) => f.feature === "quiz");
  assert.ok(quiz);
  assert.equal(quiz.used, 10);
  assert.equal(quiz.limit, null); // no per-feature override and no default
});

// ---- admin usage route ------------------------------------------------------

test("GET /api/admin/ai/usage returns budget + usage for admins", async () => {
  process.env.AI_QUOTA_GLOBAL_DAILY = "100";
  aggregateResult = {
    _count: { _all: 7 },
    _sum: { promptTokens: 70, completionTokens: 35, totalTokens: 105, estimatedCostUsd: 0.25 },
  };
  const { GET } = await import("@/app/api/admin/ai/usage/route");
  const res = await GET(new Request("http://test/api/admin/ai/usage?hours=12"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    budget: { totalUsed: number; global: { interactive: { limit: number } } };
    usage: { total: { count: number } };
    usageSinceHours: number;
  };
  assert.equal(body.usageSinceHours, 12);
  assert.equal(body.budget.totalUsed, 7);
  assert.equal(body.budget.global.interactive.limit, 100);
  assert.equal(body.usage.total.count, 7);
});

test("GET /api/admin/ai/usage is admin-gated (403 for non-admins)", async () => {
  adminAuth = async () => ({
    session: { user: { id: "u1", role: "Reader" } },
    error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
  });
  const { GET } = await import("@/app/api/admin/ai/usage/route");
  const res = await GET(new Request("http://test/api/admin/ai/usage"));
  assert.equal(res.status, 403);
});
