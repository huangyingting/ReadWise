/**
 * Rate limiter (RW-026) tests. `checkRateLimit*` are now ASYNC and backed by a
 * SHARED (DB-backed) store with an in-memory FALLBACK. No real DB is used:
 * prisma is mocked and the store mode is toggled per test via RATE_LIMIT_STORE.
 */
process.env.LOG_LEVEL = "error"; // silence api-handler + fallback warnings

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mutable mock state (per the repo's module-mock pattern) ----------------
// A tiny in-process fake of the RateLimitCounter table used by the shared store.
const store = new Map<string, number>();
let storeThrows = false;
let upsertCalls = 0;

function counterKey(bucketKey: string, windowStart: Date): string {
  return `${bucketKey}|${windowStart.getTime()}`;
}

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () => ({ session: { user: { id: "u1", role: "Reader" } } }),
      requireAdminApi: async () => ({ session: { user: { id: "u1", role: "Admin" } } }),
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        rateLimitCounter: {
          upsert: async (args: {
            where: { bucketKey_windowStart: { bucketKey: string; windowStart: Date } };
          }) => {
            upsertCalls++;
            if (storeThrows) throw new Error("simulated store outage");
            const { bucketKey, windowStart } = args.where.bucketKey_windowStart;
            const key = counterKey(bucketKey, windowStart);
            const next = (store.get(key) ?? 0) + 1;
            store.set(key, next);
            return { count: next };
          },
          deleteMany: async () => ({ count: 0 }),
        },
      },
    },
  });
});

let testSeq = 0;
function uniqueKey(label: string): string {
  return `test-${label}-${++testSeq}-${Date.now()}`;
}

async function resetStore(): Promise<void> {
  const { resetRateLimitStore } = await import("@/lib/security/rate-limit/store");
  resetRateLimitStore();
}

beforeEach(async () => {
  store.clear();
  storeThrows = false;
  upsertCalls = 0;
  await resetStore();
  delete process.env.RATE_LIMIT_STORE;
  delete process.env.RATE_LIMIT_AI_REQUESTS;
  delete process.env.RATE_LIMIT_LOOKUP_REQUESTS;
  delete process.env.RATE_LIMIT_WINDOW_MS;
});

// ---- in-memory fallback semantics (default under NODE_ENV=test) -------------

test("allows requests under the configured limit (memory fallback)", async () => {
  process.env.RATE_LIMIT_AI_REQUESTS = "3";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  const { checkRateLimitByKey } = await import("@/lib/security/rate-limit/index");
  const key = uniqueKey("allow");
  await assert.doesNotReject(() => checkRateLimitByKey(key, "ai"));
  await assert.doesNotReject(() => checkRateLimitByKey(key, "ai"));
  await assert.doesNotReject(() => checkRateLimitByKey(key, "ai"));
});

test("blocks with ApiError(429) when the limit is reached (memory)", async () => {
  process.env.RATE_LIMIT_AI_REQUESTS = "2";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  const { checkRateLimitByKey } = await import("@/lib/security/rate-limit/index");
  const { ApiError } = await import("@/lib/api-handler");
  const key = uniqueKey("block");
  await checkRateLimitByKey(key, "ai");
  await checkRateLimitByKey(key, "ai");
  let thrown: unknown;
  try {
    await checkRateLimitByKey(key, "ai");
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof ApiError, "must throw ApiError");
  assert.equal((thrown as InstanceType<typeof ApiError>).status, 429);
});

test("error message mentions the configured limit", async () => {
  process.env.RATE_LIMIT_AI_REQUESTS = "1";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  const { checkRateLimitByKey } = await import("@/lib/security/rate-limit/index");
  const { ApiError } = await import("@/lib/api-handler");
  const key = uniqueKey("msg");
  await checkRateLimitByKey(key, "ai");
  let thrown: unknown;
  try {
    await checkRateLimitByKey(key, "ai");
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof ApiError);
  assert.ok((thrown as InstanceType<typeof ApiError>).message.includes("1"));
});

test("separate scopes are independent", async () => {
  process.env.RATE_LIMIT_AI_REQUESTS = "1";
  process.env.RATE_LIMIT_LOOKUP_REQUESTS = "1";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  const { checkRateLimitByKey } = await import("@/lib/security/rate-limit/index");
  const key = uniqueKey("scopes");
  await checkRateLimitByKey(key, "ai"); // fills "ai"
  // Same key, different scope — must NOT be blocked.
  await assert.doesNotReject(() => checkRateLimitByKey(key, "lookup"));
});

test("lookup scope uses RATE_LIMIT_LOOKUP_REQUESTS env var", async () => {
  process.env.RATE_LIMIT_LOOKUP_REQUESTS = "2";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  const { checkRateLimitByKey } = await import("@/lib/security/rate-limit/index");
  const { ApiError } = await import("@/lib/api-handler");
  const key = uniqueKey("lookup");
  await checkRateLimitByKey(key, "lookup");
  await checkRateLimitByKey(key, "lookup");
  let thrown: unknown;
  try {
    await checkRateLimitByKey(key, "lookup");
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof ApiError);
  assert.equal((thrown as InstanceType<typeof ApiError>).status, 429);
});

test("resets count after the window elapses (memory)", async () => {
  process.env.RATE_LIMIT_AI_REQUESTS = "1";
  process.env.RATE_LIMIT_WINDOW_MS = "50";
  const { checkRateLimitByKey } = await import("@/lib/security/rate-limit/index");
  const { ApiError } = await import("@/lib/api-handler");
  const key = uniqueKey("reset");
  await checkRateLimitByKey(key, "ai");
  let blocked = false;
  try {
    await checkRateLimitByKey(key, "ai");
  } catch (e) {
    blocked = e instanceof ApiError;
  }
  assert.ok(blocked, "should be blocked within the window");
  await new Promise<void>((resolve) => setTimeout(resolve, 80));
  await assert.doesNotReject(() => checkRateLimitByKey(key, "ai"));
});

test("checkRateLimit delegates to checkRateLimitByKey using userId", async () => {
  process.env.RATE_LIMIT_AI_REQUESTS = "1";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  const { checkRateLimit } = await import("@/lib/security/rate-limit/index");
  const { ApiError } = await import("@/lib/api-handler");
  const userId = `u-${uniqueKey("rl")}`;
  await checkRateLimit(userId, "ai");
  let thrown: unknown;
  try {
    await checkRateLimit(userId, "ai");
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof ApiError);
  assert.equal((thrown as InstanceType<typeof ApiError>).status, 429);
});

// ---- shared (DB-backed) store path ------------------------------------------

test("shared store increments the counter via prisma and blocks at the limit", async () => {
  process.env.RATE_LIMIT_STORE = "database";
  process.env.RATE_LIMIT_AI_REQUESTS = "2";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  const { checkRateLimitByKey } = await import("@/lib/security/rate-limit/index");
  const { ApiError } = await import("@/lib/api-handler");
  const key = uniqueKey("shared");
  await checkRateLimitByKey(key, "ai"); // count → 1
  await checkRateLimitByKey(key, "ai"); // count → 2
  let thrown: unknown;
  try {
    await checkRateLimitByKey(key, "ai"); // count → 3 (> 2)
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof ApiError, "must block via the shared store");
  assert.equal((thrown as InstanceType<typeof ApiError>).status, 429);
  assert.equal(upsertCalls, 3, "all three checks must hit the shared store");
});

test("shared store keeps scopes independent in the DB store", async () => {
  process.env.RATE_LIMIT_STORE = "database";
  process.env.RATE_LIMIT_AI_REQUESTS = "1";
  process.env.RATE_LIMIT_LOOKUP_REQUESTS = "5";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  const { checkRateLimitByKey } = await import("@/lib/security/rate-limit/index");
  const key = uniqueKey("shared-scope");
  await checkRateLimitByKey(key, "ai"); // fills "ai" (limit 1)
  await assert.doesNotReject(() => checkRateLimitByKey(key, "lookup"));
});

test("incrementSharedCounter returns increasing counts for the same window", async () => {
  process.env.RATE_LIMIT_STORE = "database";
  const { incrementSharedCounter, windowStartFor } = await import("@/lib/security/rate-limit/store");
  const windowMs = 60000;
  const ws = windowStartFor(Date.now(), windowMs);
  const key = uniqueKey("incr");
  assert.equal(await incrementSharedCounter(key, ws, windowMs), 1);
  assert.equal(await incrementSharedCounter(key, ws, windowMs), 2);
  assert.equal(await incrementSharedCounter(key, ws, windowMs), 3);
});

// ---- fallback to memory when the shared store is unavailable -----------------

test("falls back to the in-memory limiter when the shared store throws", async () => {
  process.env.RATE_LIMIT_STORE = "database";
  process.env.RATE_LIMIT_AI_REQUESTS = "1";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  storeThrows = true; // DB is "down"
  const { checkRateLimitByKey } = await import("@/lib/security/rate-limit/index");
  const { ApiError } = await import("@/lib/api-handler");
  const key = uniqueKey("fallback");
  // First call: store throws → falls back to memory (allowed, count 1).
  await assert.doesNotReject(() => checkRateLimitByKey(key, "ai"));
  assert.ok(upsertCalls >= 1, "should have attempted the shared store");
  // Second call is still enforced by the in-memory fallback.
  let thrown: unknown;
  try {
    await checkRateLimitByKey(key, "ai");
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof ApiError, "memory fallback must still enforce the limit");
  assert.equal((thrown as InstanceType<typeof ApiError>).status, 429);
});

test("auto mode trips a circuit breaker and stops hitting a dead store", async () => {
  process.env.RATE_LIMIT_STORE = "auto";
  process.env.RATE_LIMIT_AI_REQUESTS = "100";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
  storeThrows = true;
  const { checkRateLimitByKey } = await import("@/lib/security/rate-limit/index");
  const key = uniqueKey("breaker");
  await checkRateLimitByKey(key, "ai"); // attempts store, fails, trips breaker
  const callsAfterFirst = upsertCalls;
  await checkRateLimitByKey(key, "ai"); // breaker open → no store attempt
  await checkRateLimitByKey(key, "ai");
  assert.equal(upsertCalls, callsAfterFirst, "breaker should prevent further store calls");
});

// ---- clientIpKey (still synchronous) ----------------------------------------

test("clientIpKey extracts first IP from x-forwarded-for", async () => {
  const { clientIpKey } = await import("@/lib/security/rate-limit/index");
  const req = new Request("http://test/", {
    headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
  });
  assert.equal(clientIpKey(req), "ip:1.2.3.4");
});

test("clientIpKey falls back to ip:unknown when header is absent", async () => {
  const { clientIpKey } = await import("@/lib/security/rate-limit/index");
  const req = new Request("http://test/");
  assert.equal(clientIpKey(req), "ip:unknown");
});
