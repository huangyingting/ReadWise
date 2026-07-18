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
      requireCapabilityApi: async () => ({ session: { user: { id: "u1", role: "Admin" } } }),
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
const DEFAULT_WINDOW_MS = "60000";

function uniqueKey(label: string): string {
  return `test-${label}-${++testSeq}-${Date.now()}`;
}

async function loadRateLimit(): Promise<typeof import("@/lib/security/rate-limit/index")> {
  return import("@/lib/security/rate-limit/index");
}

async function loadApiError(): Promise<typeof import("@/lib/api-handler").ApiError> {
  const { ApiError } = await import("@/lib/api-handler");
  return ApiError;
}

function configureLimits(env: {
  store?: string;
  aiRequests?: string;
  lookupRequests?: string;
  publicRequests?: string;
  windowMs?: string;
}): void {
  if (env.store !== undefined) process.env.RATE_LIMIT_STORE = env.store;
  if (env.aiRequests !== undefined) process.env.RATE_LIMIT_AI_REQUESTS = env.aiRequests;
  if (env.lookupRequests !== undefined) process.env.RATE_LIMIT_LOOKUP_REQUESTS = env.lookupRequests;
  if (env.publicRequests !== undefined) {
    process.env.RATE_LIMIT_PUBLIC_REQUESTS = env.publicRequests;
  }
  process.env.RATE_LIMIT_WINDOW_MS = env.windowMs ?? DEFAULT_WINDOW_MS;
}

async function assertRateLimitError(action: () => Promise<unknown>, message?: string): Promise<void> {
  const ApiError = await loadApiError();
  let thrown: unknown;
  try {
    await action();
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof ApiError, message ?? "must throw ApiError");
  assert.equal((thrown as InstanceType<typeof ApiError>).status, 429);
}

async function resetStore(): Promise<void> {
  const { resetFixedWindowCounters } = await import("@/lib/security/fixed-window-counter");
  resetFixedWindowCounters();
}

beforeEach(async () => {
  store.clear();
  storeThrows = false;
  upsertCalls = 0;
  await resetStore();
  delete process.env.RATE_LIMIT_STORE;
  delete process.env.RATE_LIMIT_AI_REQUESTS;
  delete process.env.RATE_LIMIT_LOOKUP_REQUESTS;
  delete process.env.RATE_LIMIT_PUBLIC_REQUESTS;
  delete process.env.RATE_LIMIT_WINDOW_MS;
});

// ---- in-memory fallback semantics (default under NODE_ENV=test) -------------

test("allows requests under the configured limit (memory fallback)", async () => {
  configureLimits({ aiRequests: "3" });
  const { checkRateLimitByKey } = await loadRateLimit();
  const key = uniqueKey("allow");
  await assert.doesNotReject(() => checkRateLimitByKey(key, "ai"));
  await assert.doesNotReject(() => checkRateLimitByKey(key, "ai"));
  await assert.doesNotReject(() => checkRateLimitByKey(key, "ai"));
});

test("blocks with ApiError(429) when the limit is reached (memory)", async () => {
  configureLimits({ aiRequests: "2" });
  const { checkRateLimitByKey } = await loadRateLimit();
  const key = uniqueKey("block");
  await checkRateLimitByKey(key, "ai");
  await checkRateLimitByKey(key, "ai");
  await assertRateLimitError(() => checkRateLimitByKey(key, "ai"), "must throw ApiError");
});

test("error message mentions the configured limit", async () => {
  configureLimits({ aiRequests: "1" });
  const { checkRateLimitByKey } = await loadRateLimit();
  const ApiError = await loadApiError();
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
  configureLimits({ aiRequests: "1", lookupRequests: "1" });
  const { checkRateLimitByKey } = await loadRateLimit();
  const key = uniqueKey("scopes");
  await checkRateLimitByKey(key, "ai"); // fills "ai"
  // Same key, different scope — must NOT be blocked.
  await assert.doesNotReject(() => checkRateLimitByKey(key, "lookup"));
});

test("lookup scope uses RATE_LIMIT_LOOKUP_REQUESTS env var", async () => {
  configureLimits({ lookupRequests: "2" });
  const { checkRateLimitByKey } = await loadRateLimit();
  const key = uniqueKey("lookup");
  await checkRateLimitByKey(key, "lookup");
  await checkRateLimitByKey(key, "lookup");
  await assertRateLimitError(() => checkRateLimitByKey(key, "lookup"));
});

test("resets count after the window elapses (memory)", async () => {
  configureLimits({ aiRequests: "1", windowMs: "50" });
  const { checkRateLimitByKey } = await loadRateLimit();
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

test("memory fallback preserves first-hit windows across an epoch boundary", async (t) => {
  configureLimits({ store: "memory", aiRequests: "1", windowMs: "1000" });
  let nowMs = 999;
  t.mock.method(Date, "now", () => nowMs);
  const { checkRateLimitByKey } = await loadRateLimit();
  const key = uniqueKey("first-hit-window");

  await checkRateLimitByKey(key, "ai");
  nowMs = 1_001;
  await assertRateLimitError(() => checkRateLimitByKey(key, "ai"));
  nowMs = 1_999;
  await assert.doesNotReject(() => checkRateLimitByKey(key, "ai"));
});

test("checkRateLimit delegates to checkRateLimitByKey using userId", async () => {
  configureLimits({ aiRequests: "1" });
  const { checkRateLimit } = await loadRateLimit();
  const userId = `u-${uniqueKey("rl")}`;
  await checkRateLimit(userId, "ai");
  await assertRateLimitError(() => checkRateLimit(userId, "ai"));
});

test("sessionUserRateLimitPolicy enforces by session.user.id", async () => {
  configureLimits({ aiRequests: "1" });
  const { sessionUserRateLimitPolicy, enforceRateLimitPolicy } = await loadRateLimit();
  const policy = sessionUserRateLimitPolicy("ai");
  const ctx = { session: { user: { id: uniqueKey("session-policy") } } };

  await assert.doesNotReject(() => enforceRateLimitPolicy(policy, ctx));
  await assertRateLimitError(() => enforceRateLimitPolicy(policy, ctx));
});

test("clientIpRateLimitPolicy supports route-specific onExceeded behavior", async () => {
  configureLimits({ publicRequests: "1" });
  const { clientIpRateLimitPolicy, enforceRateLimitPolicy } = await loadRateLimit();
  const policy = clientIpRateLimitPolicy("public", {
    onExceeded: () => new Response(null, { status: 204 }),
  });
  const ctx = {
    req: new Request("http://test.local/api/client-errors", {
      headers: { "x-forwarded-for": "10.0.0.1" },
    }),
  };

  await assert.doesNotReject(() => enforceRateLimitPolicy(policy, ctx));
  const fallbackResponse = await enforceRateLimitPolicy(policy, ctx);
  assert.equal(fallbackResponse?.status, 204);
});

// ---- shared (DB-backed) store path ------------------------------------------

test("shared store increments the counter via prisma and blocks at the limit", async () => {
  configureLimits({ store: "database", aiRequests: "2" });
  const { checkRateLimitByKey } = await loadRateLimit();
  const key = uniqueKey("shared");
  await checkRateLimitByKey(key, "ai"); // count → 1
  await checkRateLimitByKey(key, "ai"); // count → 2
  await assertRateLimitError(
    () => checkRateLimitByKey(key, "ai"), // count → 3 (> 2)
    "must block via the shared store",
  );
  assert.equal(upsertCalls, 3, "all three checks must hit the shared store");
});

test("shared store keeps scopes independent in the DB store", async () => {
  configureLimits({ store: "database", aiRequests: "1", lookupRequests: "5" });
  const { checkRateLimitByKey } = await loadRateLimit();
  const key = uniqueKey("shared-scope");
  await checkRateLimitByKey(key, "ai"); // fills "ai" (limit 1)
  await assert.doesNotReject(() => checkRateLimitByKey(key, "lookup"));
});

// ---- fallback to memory when the shared store is unavailable -----------------

test("falls back to the in-memory limiter when the shared store throws", async () => {
  configureLimits({ store: "database", aiRequests: "1" });
  storeThrows = true; // DB is "down"
  const { checkRateLimitByKey } = await loadRateLimit();
  const key = uniqueKey("fallback");
  // First call: store throws → falls back to memory (allowed, count 1).
  await assert.doesNotReject(() => checkRateLimitByKey(key, "ai"));
  assert.ok(upsertCalls >= 1, "should have attempted the shared store");
  // Second call is still enforced by the in-memory fallback.
  await assertRateLimitError(() => checkRateLimitByKey(key, "ai"), "memory fallback must still enforce the limit");
});

test("auto mode trips a circuit breaker and stops hitting a dead store", async () => {
  configureLimits({ store: "auto", aiRequests: "100" });
  storeThrows = true;
  const { checkRateLimitByKey } = await loadRateLimit();
  const key = uniqueKey("breaker");
  await checkRateLimitByKey(key, "ai"); // attempts store, fails, trips breaker
  const callsAfterFirst = upsertCalls;
  await checkRateLimitByKey(key, "ai"); // breaker open → no store attempt
  await checkRateLimitByKey(key, "ai");
  assert.equal(upsertCalls, callsAfterFirst, "breaker should prevent further store calls");
});

// ---- clientIpKey (still synchronous) ----------------------------------------

test("clientIpKey extracts first IP from x-forwarded-for", async () => {
  const { clientIpKey } = await loadRateLimit();
  const req = new Request("http://test/", {
    headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
  });
  assert.equal(clientIpKey(req), "ip:1.2.3.4");
});

test("clientIpKey falls back to ip:unknown when header is absent", async () => {
  const { clientIpKey } = await loadRateLimit();
  const req = new Request("http://test/");
  assert.equal(clientIpKey(req), "ip:unknown");
});
