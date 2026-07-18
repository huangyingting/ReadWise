process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";

let counterCalls: Array<{
  key: string;
  fallbackWindowAnchor: string;
}> = [];
let count = 0;

before(() => {
  mock.module("@/lib/security/fixed-window-counter", {
    namedExports: {
      consumeFixedWindow: async (input: {
        key: string;
        fallbackWindowAnchor: string;
      }) => {
        counterCalls.push(input);
        count += 1;
        return count;
      },
      fixedWindowStart: (nowMs: number, windowMs: number) =>
        Math.floor(nowMs / windowMs) * windowMs,
    },
  });
});

beforeEach(() => {
  counterCalls = [];
  count = 0;
  process.env.AI_QUOTA_FEATURE_DEFAULT_DAILY = "1";
  process.env.AI_QUOTA_WINDOW_MS = "1000";
});

after(() => {
  delete process.env.AI_QUOTA_FEATURE_DEFAULT_DAILY;
  delete process.env.AI_QUOTA_WINDOW_MS;
});

test("AI budget consumes an epoch-anchored fixed-window counter", async () => {
  const { checkAiBudget } = await import("@/lib/ai/budget");

  assert.equal(
    (await checkAiBudget({ feature: "fallback-path", kind: "background" }, 1000)).allowed,
    true,
  );
  const blocked = await checkAiBudget({ feature: "fallback-path", kind: "background" }, 1000);

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.scope, "feature");
  assert.equal(blocked.used, 2);
  assert.deepEqual(counterCalls.map(({ key, fallbackWindowAnchor }) => ({
    key,
    fallbackWindowAnchor,
  })), [
    { key: "aibudget:feature:fallback-path", fallbackWindowAnchor: "epoch" },
    { key: "aibudget:feature:fallback-path", fallbackWindowAnchor: "epoch" },
  ]);
});
