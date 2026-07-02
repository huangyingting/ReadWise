process.env.LOG_LEVEL = "error";
process.env.AI_LEDGER_ENABLED = "1";

import { after, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

type CreatedRecord = Record<string, unknown>;

let created: CreatedRecord[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        aiInvocation: {
          create: async (args: { data: CreatedRecord }) => {
            created.push(args.data);
            return { id: "ai-ledger-cache-hit", ...args.data };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  created = [];
  process.env.AI_LEDGER_ENABLED = "1";
});

after(() => {
  delete process.env.AI_LEDGER_ENABLED;
});

test("recordAiCacheHit records a successful cache-hit ledger entry by default", async () => {
  const { recordAiCacheHit } = await import("@/lib/ai/ledger");

  await recordAiCacheHit({
    feature: "ai-ledger-cache-coverage",
    model: "gpt-cache",
    promptTokens: 8,
    completionTokens: 3,
    latencyMs: 12,
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].feature, "ai-ledger-cache-coverage");
  assert.equal(created[0].status, "success");
  assert.equal(created[0].cacheHit, true);
  assert.equal(created[0].fallback, false);
  assert.equal(created[0].promptTokens, 8);
  assert.equal(created[0].completionTokens, 3);
  assert.equal(created[0].totalTokens, 11);
  assert.equal(created[0].latencyMs, 12);
  assert.ok(typeof created[0].estimatedCostUsd === "number");
  assert.ok(!("prompt" in created[0]));
  assert.ok(!("response" in created[0]));
});
