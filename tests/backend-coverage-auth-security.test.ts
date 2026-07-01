process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let bootstrappedUsers: string[];
let sharedStoreEnabled: boolean;
let sharedCounterCount: number;
let sharedCounterError: Error | null;
let loggerWarnings: unknown[];
let loggerErrors: unknown[];
let metricThrows: boolean;
let captureThrows: boolean;
let capturedSecurityErrors: unknown[];
let bufferThrows: boolean;
let ambientContext: { userId?: string; requestId?: string; path?: string } | null;
let trustedProxy: { header: string | null; list: string[]; hops: number | null };
let metricsSnapshot: unknown;

class MockApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

before(() => {
  mock.module("@auth/prisma-adapter", {
    namedExports: {
      PrismaAdapter: () => ({ adapter: "prisma" }),
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {},
    },
  });
  mock.module("@/lib/auth-providers", {
    namedExports: {
      buildProviders: () => [{ id: "credentials" }],
    },
  });
  mock.module("@/lib/auth-bootstrap", {
    namedExports: {
      bootstrapFirstUser: async (userId: string) => {
        bootstrappedUsers.push(userId);
      },
    },
  });
  mock.module("@/lib/route-policy", {
    namedExports: {
      SESSION_COOKIES: ["dev-session", "__Secure-prod-session"],
    },
  });
  mock.module("@/lib/api-handler", {
    namedExports: {
      ApiError: MockApiError,
    },
  });
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => ({
        error: (...args: unknown[]) => loggerErrors.push(args),
        warn: (...args: unknown[]) => loggerWarnings.push(args),
      }),
      getRequestContext: () => ambientContext,
    },
  });
  mock.module("@/lib/metrics", {
    namedExports: {
      getMetricsSnapshot: () => metricsSnapshot,
      recordSecurityEventMetric: () => {
        if (metricThrows) throw new Error("metric failed");
      },
    },
  });
  mock.module("@/lib/observability/errors", {
    namedExports: {
      captureError: (err: unknown, ctx: unknown) => {
        if (captureThrows) throw new Error("capture failed");
        capturedSecurityErrors.push({ err, ctx });
      },
      scrubContext: (meta: unknown) => meta,
    },
  });
  mock.module("@/lib/runtime-config/rate-limit", {
    namedExports: {
      rateLimitAdminJobRequests: () => 5,
      rateLimitAiRequests: () => 1,
      rateLimitAuthRequests: () => 6,
      rateLimitImportRequests: () => 4,
      rateLimitLookupRequests: () => 2,
      rateLimitPublicRequests: () => 3,
      rateLimitWindowMs: () => 1_000,
    },
  });
  mock.module("@/lib/runtime-config/security", {
    namedExports: {
      securityEventAlertThreshold: () => 2,
      securityEventBufferSize: () => {
        if (bufferThrows) throw new Error("buffer failed");
        return 2;
      },
      securityEventWindowMs: () => 1_000,
      trustedProxyConfig: () => trustedProxy,
    },
  });
  mock.module("@/lib/security/rate-limit/store", {
    namedExports: {
      incrementSharedCounter: async () => {
        if (sharedCounterError) throw sharedCounterError;
        return sharedCounterCount;
      },
      isSharedStoreEnabled: () => sharedStoreEnabled,
      windowStartFor: (nowMs: number, windowMs: number) => nowMs - (nowMs % windowMs),
    },
  });
});

beforeEach(() => {
  bootstrappedUsers = [];
  sharedStoreEnabled = true;
  sharedCounterCount = 1;
  sharedCounterError = null;
  loggerWarnings = [];
  loggerErrors = [];
  metricThrows = false;
  captureThrows = false;
  capturedSecurityErrors = [];
  bufferThrows = false;
  ambientContext = { userId: "ambient-user", requestId: "req-ambient", path: "/ambient" };
  trustedProxy = { header: null, list: [], hops: null };
  metricsSnapshot = { counters: [], histograms: [] };
});

test("auth options enrich sessions and bootstrap first users", async () => {
  const { authOptions } = await import("@/lib/auth");

  assert.equal(authOptions.session?.strategy, "database");
  assert.equal(authOptions.cookies?.sessionToken?.name, "dev-session");
  assert.equal(authOptions.cookies?.sessionToken?.options.secure, false);

  const withUser = await authOptions.callbacks?.session?.({
    session: { user: { name: "Reader" } },
    user: { id: "user-1", role: "Admin" },
  } as never);
  assert.deepEqual(withUser?.user, { name: "Reader", id: "user-1", role: "Admin" });

  const defaultRole = await authOptions.callbacks?.session?.({
    session: { user: {} },
    user: { id: "user-2" },
  } as never);
  assert.deepEqual(defaultRole?.user, { id: "user-2", role: "Reader" });

  const withoutSessionUser = await authOptions.callbacks?.session?.({
    session: {},
    user: { id: "user-3", role: "Admin" },
  } as never);
  assert.deepEqual(withoutSessionUser, {});

  await authOptions.events?.createUser?.({ user: { id: "new-user" } } as never);
  assert.deepEqual(bootstrappedUsers, ["new-user"]);
});

test("rate limiter maps scopes, propagates 429s, and falls back to memory on store errors", async () => {
  const { checkRateLimit, checkRateLimitByKey, clientIpKey } = await import("@/lib/security/rate-limit/index");
  const realDateNow = Date.now;
  const realRandom = Math.random;

  try {
    await checkRateLimitByKey("user-1", "public");
    await checkRateLimitByKey("user-1", "import");
    await checkRateLimitByKey("user-1", "admin-job");
    await checkRateLimitByKey("user-1", "auth");
    await checkRateLimit("user-1", "lookup");
    assert.equal(
      clientIpKey(new Request("https://readwise.test", { headers: { "x-real-ip": "198.51.100.9" } })),
      "ip:198.51.100.9",
    );

    sharedCounterCount = 2;
    await assert.rejects(() => checkRateLimitByKey("user-1", "ai"), {
      name: "ApiError",
      status: 429,
    });

    sharedCounterError = new Error("store down");
    await checkRateLimitByKey("fallback", "lookup");
    assert.ok(JSON.stringify(loggerWarnings).includes("rate_limit.fallback_memory"));

    sharedStoreEnabled = false;
    sharedCounterError = null;
    await checkRateLimitByKey("memory-user", "lookup");
    await checkRateLimitByKey("memory-user", "lookup");
    await assert.rejects(() => checkRateLimitByKey("memory-user", "lookup"), {
      name: "ApiError",
      status: 429,
    });

    Date.now = () => 0;
    Math.random = () => 1;
    await checkRateLimitByKey("stale-user", "lookup");
    Date.now = () => 3_001;
    Math.random = () => 0;
    await checkRateLimitByKey("fresh-user", "lookup");
  } finally {
    Date.now = realDateNow;
    Math.random = realRandom;
  }
});

test("security events tolerate metrics, ring, spike-store, and alert failures", async () => {
  const realDateNow = Date.now;
  const realRandom = Math.random;
  const {
    getRecentSecurityEvents,
    recordSecurityEvent,
    resetSecurityEvents,
    SECURITY_EVENT_TYPES,
  } = await import("@/lib/security/events");

  try {
    resetSecurityEvents();
    Date.now = () => 0;
    Math.random = () => 1;
    let record = recordSecurityEvent({
      type: SECURITY_EVENT_TYPES.unauthorized,
      severity: "low",
      meta: { safe: true },
    });
    assert.equal(record.actorId, "ambient-user");
    assert.equal(record.alert, false);

    Date.now = () => 3_001;
    Math.random = () => 0;
    sharedCounterError = new Error("spike store down");
    record = recordSecurityEvent({
      type: SECURITY_EVENT_TYPES.forbidden,
      severity: "critical",
      ip: "127.0.0.1",
      status: 403,
    });
    await Promise.resolve();
    assert.equal(record.alert, true);
    assert.equal(capturedSecurityErrors.length, 1);
    assert.ok(JSON.stringify(loggerErrors).includes("security.event"));

    metricThrows = true;
    bufferThrows = true;
    captureThrows = true;
    recordSecurityEvent({
      type: SECURITY_EVENT_TYPES.csrfBlocked,
      severity: "high",
      actorId: "actor-1",
      requestId: "req-1",
      route: "/csrf",
    });

    metricThrows = false;
    bufferThrows = false;
    captureThrows = false;
    recordSecurityEvent({
      type: SECURITY_EVENT_TYPES.importBlocked,
      severity: "medium",
      actorId: "spiky",
    });
    record = recordSecurityEvent({
      type: SECURITY_EVENT_TYPES.importBlocked,
      severity: "medium",
      actorId: "spiky",
    });
    assert.equal(record.alert, true);
    assert.ok(getRecentSecurityEvents(1)[0].count >= 2);
    assert.ok(getRecentSecurityEvents(0).length >= 1);
  } finally {
    Date.now = realDateNow;
    Math.random = realRandom;
  }
});

test("client IP helpers normalize, match CIDRs, and resolve trusted proxy strategies", async () => {
  const {
    clientIp,
    clientIpKey,
    ipInCidr,
    isTrustedProxyIp,
    normalizeIp,
    parseForwardedFor,
    resolveClientIp,
  } = await import("@/lib/security/client-ip");

  assert.equal(normalizeIp(undefined), null);
  assert.equal(normalizeIp("   "), null);
  assert.equal(normalizeIp("[2001:DB8::1]:443"), "2001:db8::1");
  assert.equal(normalizeIp("192.0.2.1:443"), "192.0.2.1");
  assert.equal(normalizeIp("::ffff:192.0.2.44"), "192.0.2.44");
  assert.deepEqual(parseForwardedFor("bad, 198.51.100.1, [2001:db8::2]"), [
    "198.51.100.1",
    "2001:db8::2",
  ]);

  assert.equal(ipInCidr("198.51.100.10", "198.51.100.0/24"), true);
  assert.equal(ipInCidr("198.51.101.10", "198.51.100.0/24"), false);
  assert.equal(ipInCidr("2001:db8::abcd", "2001:db8::/32"), true);
  assert.equal(ipInCidr("2001:db9::1", "2001:db8::/32"), false);
  assert.equal(ipInCidr("2001:db8::192.0.2.44", "2001:db8::/96"), true);
  assert.equal(
    ipInCidr("2001:0db8:0000:0000:0000:0000:0000:0001", "2001:db8::/32"),
    true,
  );
  assert.equal(ipInCidr("198.51.100.1", "bad/99"), false);
  assert.equal(ipInCidr("198.51.100.1", "198.51.100.1"), true);
  assert.equal(isTrustedProxyIp("10.1.2.3", ["192.0.2.0/24", "10.0.0.0/8"]), true);

  trustedProxy = { header: "cf-connecting-ip", list: [], hops: null };
  assert.deepEqual(
    resolveClientIp(new Request("https://readwise.test", { headers: { "cf-connecting-ip": "203.0.113.5" } })),
    { ip: "203.0.113.5", source: "trusted-header" },
  );

  trustedProxy = { header: null, list: ["10.0.0.0/8"], hops: null };
  assert.deepEqual(
    resolveClientIp(new Request("https://readwise.test", { headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.2" } })),
    { ip: "203.0.113.1", source: "cidr-walk" },
  );
  assert.deepEqual(
    resolveClientIp(new Request("https://readwise.test", { headers: { "x-forwarded-for": "10.0.0.1, 10.0.0.2" } })),
    { ip: "10.0.0.1", source: "cidr-walk" },
  );

  trustedProxy = { header: null, list: [], hops: 1 };
  assert.deepEqual(
    resolveClientIp(
      new Request("https://readwise.test", {
        headers: { "x-forwarded-for": "198.51.100.1, 198.51.100.2, 198.51.100.3" },
      }),
    ),
    { ip: "198.51.100.2", source: "hop-count" },
  );
  trustedProxy.hops = 99;
  assert.equal(clientIp(new Request("https://readwise.test", { headers: { "x-forwarded-for": "198.51.100.9" } })), "198.51.100.9");

  trustedProxy = { header: null, list: [], hops: null };
  assert.deepEqual(
    resolveClientIp(new Request("https://readwise.test", { headers: { "x-forwarded-for": "198.51.100.7" } })),
    { ip: "198.51.100.7", source: "forwarded-leftmost" },
  );
  assert.deepEqual(
    resolveClientIp(new Request("https://readwise.test", { headers: { "x-real-ip": "198.51.100.8" } })),
    { ip: "198.51.100.8", source: "platform-header" },
  );
  assert.equal(clientIpKey(new Request("https://readwise.test")), "ip:unknown");
});

test("SLO catalog evaluates API, worker, and AI availability and latency", async () => {
  const { evaluateSlos, SLI_CATALOG } = await import("@/lib/observability/slo-catalog");
  metricsSnapshot = {
    counters: [
      { name: "readwise_api_requests_total", labels: { route: "/api/auth/signin", status_class: "2xx" }, value: 99 },
      { name: "readwise_api_requests_total", labels: { route: "/api/auth/signin", status_class: "5xx" }, value: 1 },
      { name: "readwise_worker_jobs_total", labels: { outcome: "success" }, value: 9 },
      { name: "readwise_worker_jobs_total", labels: { outcome: "failed" }, value: 1 },
      { name: "readwise_ai_calls_total", labels: { outcome: "success" }, value: 19 },
      { name: "readwise_ai_calls_total", labels: { outcome: "error" }, value: 1 },
    ],
    histograms: [
      {
        name: "readwise_api_request_duration_ms",
        labels: { route: "/api/feed" },
        count: 10,
        buckets: [
          { le: 500, count: 8 },
          { le: 1_000, count: 9 },
          { le: Infinity, count: 10 },
        ],
      },
      {
        name: "readwise_worker_job_duration_ms",
        labels: {},
        count: 5,
        buckets: [
          { le: 60_000, count: 4 },
          { le: Infinity, count: 5 },
        ],
      },
      {
        name: "readwise_ai_call_duration_ms",
        labels: { outcome: "success" },
        count: 6,
        buckets: [
          { le: 3_000, count: 5 },
          { le: Infinity, count: 6 },
        ],
      },
    ],
  };

  const report = evaluateSlos();
  assert.equal(report.total, SLI_CATALOG.length);
  assert.ok(report.ok + report.breaching + report.noData === report.total);
  assert.equal(report.slis.find((sli) => sli.key === "sign_in")?.sampleCount, 100);
  assert.equal(report.slis.find((sli) => sli.key === "dashboard_load")?.value, 0.9);
  assert.ok(report.slis.some((sli) => sli.kind === "latency" && sli.sampleCount > 0));
});
