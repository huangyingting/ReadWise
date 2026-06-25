/**
 * AI invocation ledger (RW-019) tests. No real DB/network — prisma is mocked
 * and the ledger is force-enabled via AI_LEDGER_ENABLED=1. Verifies records are
 * written for every outcome path, that ONLY metadata is stored (never the
 * prompt/response), and that a ledger write failure never breaks an AI feature.
 */
process.env.LOG_LEVEL = "error"; // silence best-effort write warnings
process.env.AI_LEDGER_ENABLED = "1"; // opt the ledger write path in under tests
process.env.AI_MAX_RETRIES = "0"; // keep AI paths fast/deterministic

import { test, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { enableAi, disableAi } from "./helpers";

// ---- mutable mock state (per the repo's module-mock pattern) -----------------
type CreatedRecord = Record<string, unknown>;
let created: CreatedRecord[] = [];
let failWrite = false;
let aggregateResult: unknown;
let countResult = 0;
const groupByResults: Record<string, unknown[]> = { feature: [], model: [], status: [] };

function zeroAggregate() {
  return {
    _count: { _all: 0 },
    _sum: { promptTokens: null, completionTokens: null, totalTokens: null, estimatedCostUsd: null },
  };
}

before(() => {
  aggregateResult = zeroAggregate();
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        aiInvocation: {
          create: async (args: { data: CreatedRecord }) => {
            if (failWrite) throw new Error("simulated ledger write failure");
            created.push(args.data);
            return { id: "rec-1", ...args.data };
          },
          aggregate: async () => aggregateResult,
          count: async () => countResult,
          groupBy: async (args: { by: string[] }) => groupByResults[args.by[0]] ?? [],
        },
      },
    },
  });
});

beforeEach(() => {
  created = [];
  failWrite = false;
  countResult = 0;
  aggregateResult = zeroAggregate();
  groupByResults.feature = [];
  groupByResults.model = [];
  groupByResults.status = [];
  disableAi();
});

after(() => {
  delete process.env.AI_LEDGER_ENABLED;
  delete process.env.AI_MAX_RETRIES;
  disableAi();
});

// Keys that would indicate prompt/response content leaked into the ledger.
const CONTENT_KEYS = ["messages", "prompt", "prompts", "response", "content", "text", "body", "completion"];

function assertMetadataOnly(record: CreatedRecord): void {
  for (const key of CONTENT_KEYS) {
    assert.ok(!(key in record), `ledger record must not store content field "${key}"`);
  }
}

// ---- estimateAiCostUsd -------------------------------------------------------

test("estimateAiCostUsd returns null when no tokens are known", async () => {
  const { estimateAiCostUsd } = await import("@/lib/ai-ledger");
  assert.equal(estimateAiCostUsd({ model: "gpt-test" }), null);
  assert.equal(estimateAiCostUsd({ model: "gpt-test", promptTokens: null, completionTokens: null }), null);
});

test("estimateAiCostUsd computes a positive cost from tokens", async () => {
  const { estimateAiCostUsd } = await import("@/lib/ai-ledger");
  const cost = estimateAiCostUsd({ model: "gpt-test", promptTokens: 1000, completionTokens: 1000 });
  assert.ok(typeof cost === "number" && cost > 0, "cost should be a positive number");
});

test("estimateAiCostUsd honors per-model rate overrides from AI_COST_RATES", async () => {
  process.env.AI_COST_RATES = JSON.stringify({ "gpt-test": { prompt: 1, completion: 2 } });
  try {
    const { estimateAiCostUsd } = await import("@/lib/ai-ledger");
    // (1000/1000)*1 + (1000/1000)*2 = 3
    const cost = estimateAiCostUsd({ model: "my-gpt-test-deploy", promptTokens: 1000, completionTokens: 1000 });
    assert.equal(cost, 3);
  } finally {
    delete process.env.AI_COST_RATES;
  }
});

// ---- recordAiInvocation: direct outcome paths -------------------------------

test("recordAiInvocation writes a success record (metadata only)", async () => {
  const { recordAiInvocation } = await import("@/lib/ai-ledger");
  await recordAiInvocation({
    feature: "translation",
    model: "gpt-test",
    status: "success",
    promptTokens: 10,
    completionTokens: 5,
    latencyMs: 42,
  });
  assert.equal(created.length, 1);
  const rec = created[0];
  assert.equal(rec.feature, "translation");
  assert.equal(rec.status, "success");
  assert.equal(rec.fallback, false);
  assert.equal(rec.cacheHit, false);
  assert.equal(rec.totalTokens, 15);
  assert.ok(typeof rec.estimatedCostUsd === "number");
  assertMetadataOnly(rec);
});

test("recordAiInvocation marks non-success outcomes as fallback", async () => {
  const { recordAiInvocation } = await import("@/lib/ai-ledger");
  await recordAiInvocation({ feature: "quiz", status: "unconfigured" });
  await recordAiInvocation({ feature: "quiz", status: "error", errorMessage: "HTTP 500" });
  await recordAiInvocation({ feature: "quiz", status: "empty" });
  assert.equal(created.length, 3);
  for (const rec of created) {
    assert.equal(rec.fallback, true, `status ${String(rec.status)} should set fallback=true`);
    assertMetadataOnly(rec);
  }
  assert.equal(created[1].errorMessage, "HTTP 500");
});

test("recordAiInvocation is a no-op when the ledger is disabled", async () => {
  process.env.AI_LEDGER_ENABLED = "0";
  try {
    const { recordAiInvocation } = await import("@/lib/ai-ledger");
    await recordAiInvocation({ feature: "tags", status: "success" });
    assert.equal(created.length, 0);
  } finally {
    process.env.AI_LEDGER_ENABLED = "1";
  }
});

test("recordAiInvocation never throws on a write failure", async () => {
  failWrite = true;
  const { recordAiInvocation } = await import("@/lib/ai-ledger");
  await assert.doesNotReject(() => recordAiInvocation({ feature: "vocab", status: "success" }));
  assert.equal(created.length, 0);
});

// ---- integration via chatCompleteWithMeta / chatComplete --------------------

test("chatCompleteWithMeta records a success invocation with token metadata", async (t) => {
  enableAi();
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    disableAi();
  });
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "hola mundo" } }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        model: "gpt-test-deploy",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  const { chatCompleteWithMeta } = await import("@/lib/ai");
  const result = await chatCompleteWithMeta([{ role: "user", content: "secret prompt" }], {
    feature: "translation",
    articleId: "article-42",
  });
  assert.ok(result);
  assert.equal(created.length, 1);
  const rec = created[0];
  assert.equal(rec.feature, "translation");
  assert.equal(rec.status, "success");
  assert.equal(rec.fallback, false);
  assert.equal(rec.model, "gpt-test-deploy");
  assert.equal(rec.articleId, "article-42");
  assert.equal(rec.totalTokens, 16);
  // The prompt text must NEVER appear anywhere in the stored record.
  assert.ok(!JSON.stringify(rec).includes("secret prompt"));
  assertMetadataOnly(rec);
});

test("chatComplete records an unconfigured (fallback) invocation", async () => {
  disableAi(); // provider not configured
  const { chatComplete } = await import("@/lib/ai");
  const result = await chatComplete([{ role: "user", content: "hi" }], { feature: "grammar" });
  assert.equal(result, null);
  assert.equal(created.length, 1);
  assert.equal(created[0].status, "unconfigured");
  assert.equal(created[0].fallback, true);
});

test("chatCompleteWithMeta records an error invocation on a 5xx", async (t) => {
  enableAi();
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    disableAi();
  });
  globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;

  const { chatCompleteWithMeta } = await import("@/lib/ai");
  const result = await chatCompleteWithMeta([{ role: "user", content: "x" }], { feature: "tutor" });
  assert.equal(result, null);
  assert.equal(created.length, 1);
  assert.equal(created[0].status, "error");
  assert.equal(created[0].fallback, true);
});

test("chatCompleteWithMeta records an empty invocation when content is blank", async (t) => {
  enableAi();
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    disableAi();
  });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const { chatCompleteWithMeta } = await import("@/lib/ai");
  const result = await chatCompleteWithMeta([{ role: "user", content: "x" }], { feature: "quiz" });
  assert.equal(result, null);
  assert.equal(created.length, 1);
  assert.equal(created[0].status, "empty");
});

test("a ledger write failure does not break chatComplete", async (t) => {
  failWrite = true; // every ledger write throws
  enableAi();
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    disableAi();
  });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "still works" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const { chatComplete } = await import("@/lib/ai");
  const result = await chatComplete([{ role: "user", content: "hi" }], { feature: "translation" });
  assert.equal(result, "still works", "AI feature must succeed despite a ledger write failure");
  assert.equal(created.length, 0);
});

// ---- summarizeAiUsage --------------------------------------------------------

test("summarizeAiUsage returns zeroed totals when there are no records", async () => {
  const { summarizeAiUsage } = await import("@/lib/ai-usage-summary");
  const summary = await summarizeAiUsage({ since: new Date("2026-01-01T00:00:00Z") });
  assert.equal(summary.total.count, 0);
  assert.equal(summary.total.estimatedCostUsd, 0);
  assert.deepEqual(summary.byFeature, []);
  assert.equal(summary.range.since, "2026-01-01T00:00:00.000Z");
});

test("summarizeAiUsage aggregates grouped counts and token sums", async () => {
  aggregateResult = {
    _count: { _all: 3 },
    _sum: { promptTokens: 30, completionTokens: 12, totalTokens: 42, estimatedCostUsd: 0.5 },
  };
  countResult = 1;
  groupByResults.feature = [
    { feature: "translation", _count: { _all: 2 }, _sum: { promptTokens: 20, completionTokens: 8, totalTokens: 28, estimatedCostUsd: 0.3 } },
    { feature: "quiz", _count: { _all: 1 }, _sum: { promptTokens: 10, completionTokens: 4, totalTokens: 14, estimatedCostUsd: 0.2 } },
  ];
  const { summarizeAiUsage } = await import("@/lib/ai-usage-summary");
  const summary = await summarizeAiUsage();
  assert.equal(summary.total.count, 3);
  assert.equal(summary.total.totalTokens, 42);
  assert.equal(summary.total.estimatedCostUsd, 0.5);
  assert.equal(summary.total.fallbackCount, 1);
  assert.equal(summary.total.cacheHitCount, 1);
  assert.equal(summary.byFeature.length, 2);
  assert.equal(summary.byFeature[0].key, "translation"); // sorted by count desc
  assert.equal(summary.byFeature[0].count, 2);
  assert.equal(summary.byFeature[0].totalTokens, 28);
});
