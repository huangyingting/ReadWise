process.env.LOG_LEVEL = "error"; // silence api-handler logs during rate-limit tests

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mocks required by the import chain: rate-limit → api-handler → api-auth ----

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () => ({ session: { user: { id: "u1", role: "Reader" } } }),
      requireAdminApi: async () => ({ session: { user: { id: "u1", role: "Admin" } } }),
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: { prisma: {} },
  });
});

// Unique key helper — prevents buckets from the same test-scope leaking across tests.
let testSeq = 0;
function uniqueKey(label: string): string {
  return `test-${label}-${++testSeq}-${Date.now()}`;
}

// ---- allow: under the limit ---------------------------------------------

test("allows requests under the configured limit", async () => {
  process.env.RATE_LIMIT_AI_REQUESTS = "3";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  try {
    const { checkRateLimitByKey } = await import("@/lib/rate-limit");
    const key = uniqueKey("allow");
    // 3 calls should all succeed without throwing
    assert.doesNotThrow(() => checkRateLimitByKey(key, "ai"));
    assert.doesNotThrow(() => checkRateLimitByKey(key, "ai"));
    assert.doesNotThrow(() => checkRateLimitByKey(key, "ai"));
  } finally {
    delete process.env.RATE_LIMIT_AI_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
  }
});

test("first request always succeeds regardless of limit", async () => {
  process.env.RATE_LIMIT_AI_REQUESTS = "1";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  try {
    const { checkRateLimitByKey } = await import("@/lib/rate-limit");
    assert.doesNotThrow(() => checkRateLimitByKey(uniqueKey("first"), "ai"));
  } finally {
    delete process.env.RATE_LIMIT_AI_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
  }
});

// ---- block: at the limit ------------------------------------------------

test("blocks with ApiError(429) when limit is reached", async () => {
  process.env.RATE_LIMIT_AI_REQUESTS = "2";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  try {
    const { checkRateLimitByKey } = await import("@/lib/rate-limit");
    const { ApiError } = await import("@/lib/api-handler");
    const key = uniqueKey("block");
    // First two calls fill the bucket (count reaches limit)
    checkRateLimitByKey(key, "ai"); // count → 1
    checkRateLimitByKey(key, "ai"); // count → 2 (== limit)
    // Third call must throw ApiError(429)
    let thrown: unknown;
    try {
      checkRateLimitByKey(key, "ai");
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof ApiError, "must throw ApiError");
    assert.equal((thrown as InstanceType<typeof ApiError>).status, 429);
  } finally {
    delete process.env.RATE_LIMIT_AI_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
  }
});

test("error message mentions the configured limit", async () => {
  process.env.RATE_LIMIT_AI_REQUESTS = "1";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  try {
    const { checkRateLimitByKey } = await import("@/lib/rate-limit");
    const { ApiError } = await import("@/lib/api-handler");
    const key = uniqueKey("msg");
    checkRateLimitByKey(key, "ai"); // fills bucket
    let thrown: unknown;
    try {
      checkRateLimitByKey(key, "ai");
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof ApiError);
    assert.ok(
      (thrown as InstanceType<typeof ApiError>).message.includes("1"),
      "error message should mention the limit of 1",
    );
  } finally {
    delete process.env.RATE_LIMIT_AI_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
  }
});

test("lookup scope uses RATE_LIMIT_LOOKUP_REQUESTS env var", async () => {
  process.env.RATE_LIMIT_LOOKUP_REQUESTS = "2";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  try {
    const { checkRateLimitByKey } = await import("@/lib/rate-limit");
    const { ApiError } = await import("@/lib/api-handler");
    const key = uniqueKey("lookup");
    checkRateLimitByKey(key, "lookup");
    checkRateLimitByKey(key, "lookup");
    let thrown: unknown;
    try {
      checkRateLimitByKey(key, "lookup");
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof ApiError);
    assert.equal((thrown as InstanceType<typeof ApiError>).status, 429);
  } finally {
    delete process.env.RATE_LIMIT_LOOKUP_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
  }
});

// ---- reset: window expiry -----------------------------------------------

test("resets count after the window elapses", async () => {
  process.env.RATE_LIMIT_AI_REQUESTS = "1";
  process.env.RATE_LIMIT_WINDOW_MS = "50"; // 50 ms window
  try {
    const { checkRateLimitByKey } = await import("@/lib/rate-limit");
    const { ApiError } = await import("@/lib/api-handler");
    const key = uniqueKey("reset");
    // Fill the bucket
    checkRateLimitByKey(key, "ai");
    // Confirm it's blocked
    let blocked = false;
    try {
      checkRateLimitByKey(key, "ai");
    } catch (e) {
      blocked = e instanceof ApiError;
    }
    assert.ok(blocked, "should be blocked within the window");
    // Wait for the window to expire (50 ms + buffer)
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    // Now the window has expired — first call in the new window succeeds
    assert.doesNotThrow(() => checkRateLimitByKey(key, "ai"));
  } finally {
    delete process.env.RATE_LIMIT_AI_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
  }
});

test("independent keys do not interfere with each other", async () => {
  process.env.RATE_LIMIT_AI_REQUESTS = "1";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  try {
    const { checkRateLimitByKey } = await import("@/lib/rate-limit");
    const keyA = uniqueKey("indepA");
    const keyB = uniqueKey("indepB");
    checkRateLimitByKey(keyA, "ai"); // fills keyA
    // keyB is a fresh bucket — must succeed
    assert.doesNotThrow(() => checkRateLimitByKey(keyB, "ai"));
  } finally {
    delete process.env.RATE_LIMIT_AI_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
  }
});

// ---- checkRateLimit (userId-keyed public API) ----------------------------

test("checkRateLimit delegates to checkRateLimitByKey using userId", async () => {
  process.env.RATE_LIMIT_AI_REQUESTS = "1";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  try {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const { ApiError } = await import("@/lib/api-handler");
    const userId = `u-${uniqueKey("rl")}`;
    checkRateLimit(userId, "ai"); // fills bucket
    let thrown: unknown;
    try {
      checkRateLimit(userId, "ai");
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof ApiError);
    assert.equal((thrown as InstanceType<typeof ApiError>).status, 429);
  } finally {
    delete process.env.RATE_LIMIT_AI_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
  }
});

// ---- clientIpKey ---------------------------------------------------------

test("clientIpKey extracts first IP from x-forwarded-for", async () => {
  const { clientIpKey } = await import("@/lib/rate-limit");
  const req = new Request("http://test/", {
    headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
  });
  assert.equal(clientIpKey(req), "ip:1.2.3.4");
});

test("clientIpKey falls back to ip:unknown when header is absent", async () => {
  const { clientIpKey } = await import("@/lib/rate-limit");
  const req = new Request("http://test/");
  assert.equal(clientIpKey(req), "ip:unknown");
});
