process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";

let sharedAttempts = 0;

before(() => {
  mock.module("@/lib/security/rate-limit/store", {
    namedExports: {
      incrementSharedCounter: async () => {
        sharedAttempts++;
        throw new Error("shared store unavailable");
      },
      isSharedStoreEnabled: () => true,
      windowStartFor: (nowMs: number, windowMs: number) =>
        Math.floor(nowMs / windowMs) * windowMs,
    },
  });
});

beforeEach(async () => {
  sharedAttempts = 0;
  process.env.AI_QUOTA_FEATURE_DEFAULT_DAILY = "1";
  process.env.AI_QUOTA_WINDOW_MS = "1000";
  const { resetAiBudget } = await import("@/lib/ai/budget");
  resetAiBudget();
});

after(() => {
  delete process.env.AI_QUOTA_FEATURE_DEFAULT_DAILY;
  delete process.env.AI_QUOTA_WINDOW_MS;
});

test("AI budget falls back to in-memory counters when the shared store throws", async () => {
  const { checkAiBudget } = await import("@/lib/ai/budget");

  assert.equal(
    (await checkAiBudget({ feature: "fallback-path", kind: "background" }, 1000)).allowed,
    true,
  );
  const blocked = await checkAiBudget({ feature: "fallback-path", kind: "background" }, 1000);

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.scope, "feature");
  assert.equal(blocked.used, 2);
  assert.equal(sharedAttempts, 2);
});
