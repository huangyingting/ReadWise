/**
 * HTTP route tests for admin scrape trigger + admin slo + admin stats (admin cluster).
 * TEST2-5, TEST2-14
 *
 * Covers:
 *   POST /api/admin/scrape/trigger — 401, 403, 400 (unknown provider), 400 (neither
 *                                    provider nor all), happy path; asserts audit event
 *                                    and security event are recorded.
 *   GET  /api/admin/slo           — 401, 403, 200
 *   GET  /api/admin/stats         — 401, 403, 200
 *
 * Mocks: @/lib/api-auth, @/lib/scraper/providers, @/lib/scraper/discovery,
 *        @/lib/scraper, @/lib/cache, @/lib/security/audit, @/lib/security/events,
 *        @/lib/security/client-ip, @/lib/observability/slo, @/lib/admin.
 * No DB, no real auth, no network.
 *
 * NOTE: Do NOT import anything from @/lib/api-handler at the top level.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, jsonPost } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";

// Audit captures
let auditCalls: { action: string }[] = [];

// Security event captures
let securityEvents: { type: string; severity?: string }[] = [];

// Scraper stubs
let discoverUrls: string[] = ["https://test.example.com/article-1"];
let scrapeResult: Record<string, unknown> | null = {
  title: "Test Article",
  url: "https://test.example.com/article-1",
  text: "Article body text",
};
let saveOutcome: { status: "saved" | "skipped" | "failed" } = { status: "saved" };

// SLO stub
const sloReport = { slis: [], ok: true };
const sliCatalog = [{ id: "test-sli", description: "Test SLI", slo: 0.999 }];

// Admin stats stub
const adminOverview = {
  articles: { total: 10, published: 8 },
  users: { total: 5 },
};

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  // Scraper provider registry — exposes one test provider
  mock.module("@/lib/scraper/providers", {
    namedExports: {
      PROVIDERS: [{ key: "test-provider", name: "Test Provider" }],
      getProvider: (key: string) =>
        key === "test-provider" ? { key: "test-provider", name: "Test Provider" } : null,
    },
  });

  mock.module("@/lib/scraper/discovery", {
    namedExports: {
      discoverProviderUrls: async () => discoverUrls,
    },
  });

  mock.module("@/lib/scraper", {
    namedExports: {
      scrapeUrl: async () => scrapeResult,
      saveDraftArticle: async (
        _article: unknown,
        _auditInput: (created: { id: string }) => unknown,
      ) => {
        // Call the audit builder to capture the audit log
        const auditArg = _auditInput({ id: "article-new" });
        auditCalls.push(auditArg as { action: string });
        return saveOutcome;
      },
    },
  });

  mock.module("@/lib/cache", {
    namedExports: {
      revalidateArticlesCache: () => {},
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        adminScrapeTrigger: "admin.scrape.trigger",
        adminArticleIngest: "admin.article.ingest",
        securityAdminAccessDenied: "security.admin_access_denied",
      },
      auditRequestInfo: (_req: Request) => ({ ipAddress: null, userAgent: null }),
      recordAuditFromRequest: async (input: { action: string }) => {
        auditCalls.push(input);
      },
      tryRecordAuditLog: async (input: { action: string }) => {
        auditCalls.push(input);
      },
    },
  });

  mock.module("@/lib/security/events", {
    namedExports: {
      SECURITY_EVENT_TYPES: {
        unauthorized: "auth.unauthorized",
        forbidden: "auth.forbidden",
        adminAccessDenied: "auth.admin_denied",
        rateLimited: "rate_limit.exceeded",
        csrfBlocked: "csrf.blocked",
        adminMutation: "admin.mutation",
        importFailed: "import.failed",
        importBlocked: "import.blocked",
        suspiciousLookup: "lookup.suspicious_volume",
      },
      recordSecurityEvent: (input: { type: string; severity?: string }) => {
        securityEvents.push(input);
      },
    },
  });

  mock.module("@/lib/security/client-ip", {
    namedExports: {
      clientIp: () => "127.0.0.1",
      clientIpKey: () => "ip:127.0.0.1",
    },
  });

  // Admin SLO
  mock.module("@/lib/observability/slo", {
    namedExports: {
      SLI_CATALOG: sliCatalog,
      evaluateSlos: () => sloReport,
    },
  });

  // Admin stats
  mock.module("@/lib/admin", {
    namedExports: {
      getAdminOverview: async () => adminOverview,
    },
  });
});

beforeEach(() => {
  authState = "ok";
  auditCalls = [];
  securityEvents = [];
  discoverUrls = ["https://test.example.com/article-1"];
  scrapeResult = { title: "Test Article", url: "https://test.example.com/article-1", text: "body" };
  saveOutcome = { status: "saved" };
});

// ===========================================================================
// POST /api/admin/scrape/trigger
// ===========================================================================

test("POST /api/admin/scrape/trigger returns 401 when not authenticated", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/admin/scrape/trigger/route")) as { POST: RouteHandler };
  const res = await POST(jsonPost("http://test/api/admin/scrape/trigger", { provider: "test-provider" }));
  assert.equal(res.status, 401);
});

test("POST /api/admin/scrape/trigger returns 403 when authenticated but non-admin", async () => {
  authState = "forbidden";
  const { POST } = (await import("@/app/api/admin/scrape/trigger/route")) as { POST: RouteHandler };
  const res = await POST(jsonPost("http://test/api/admin/scrape/trigger", { provider: "test-provider" }));
  assert.equal(res.status, 403);
});

test("POST /api/admin/scrape/trigger returns 400 for an unknown provider key", async () => {
  const { POST } = (await import("@/app/api/admin/scrape/trigger/route")) as { POST: RouteHandler };
  const res = await POST(jsonPost("http://test/api/admin/scrape/trigger", { provider: "nonexistent" }));
  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.match(body.error, /Unknown provider/i);
});

test("POST /api/admin/scrape/trigger returns 400 when neither provider nor all is set", async () => {
  const { POST } = (await import("@/app/api/admin/scrape/trigger/route")) as { POST: RouteHandler };
  const res = await POST(jsonPost("http://test/api/admin/scrape/trigger", {}));
  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.ok(typeof body.error === "string");
});

test("POST /api/admin/scrape/trigger happy path returns 200 with results summary", async () => {
  const { POST } = (await import("@/app/api/admin/scrape/trigger/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/admin/scrape/trigger", { provider: "test-provider", limit: 5 }),
  );
  assert.equal(res.status, 200);
  const body = await res.json() as {
    ok: boolean;
    results: { provider: string; discovered: number; saved: number }[];
    totalSaved: number;
  };
  assert.equal(body.ok, true);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].provider, "test-provider");
  assert.equal(body.results[0].discovered, 1);
  assert.equal(body.results[0].saved, 1);
  assert.equal(body.totalSaved, 1);
});

test("POST /api/admin/scrape/trigger records an audit event", async () => {
  const { POST } = (await import("@/app/api/admin/scrape/trigger/route")) as { POST: RouteHandler };
  await POST(jsonPost("http://test/api/admin/scrape/trigger", { provider: "test-provider" }));
  const scrapeAudit = auditCalls.find((c) => c.action === "admin.scrape.trigger");
  assert.ok(scrapeAudit, "audit event admin.scrape.trigger should be recorded");
});

test("POST /api/admin/scrape/trigger records a security event on successful admin mutation", async () => {
  const { POST } = (await import("@/app/api/admin/scrape/trigger/route")) as { POST: RouteHandler };
  await POST(jsonPost("http://test/api/admin/scrape/trigger", { provider: "test-provider" }));
  const mutation = securityEvents.find((e) => e.type === "admin.mutation");
  assert.ok(mutation, "security event admin.mutation should be recorded for successful admin POST");
});

test("POST /api/admin/scrape/trigger with all:true scrapes all providers", async () => {
  const { POST } = (await import("@/app/api/admin/scrape/trigger/route")) as { POST: RouteHandler };
  const res = await POST(jsonPost("http://test/api/admin/scrape/trigger", { all: true }));
  assert.equal(res.status, 200);
  const body = await res.json() as { results: unknown[] };
  // One result per provider in the mock PROVIDERS array
  assert.equal(body.results.length, 1);
});

// ===========================================================================
// GET /api/admin/slo
// ===========================================================================

test("GET /api/admin/slo returns 401 when not authenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/admin/slo/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/admin/slo"));
  assert.equal(res.status, 401);
});

test("GET /api/admin/slo returns 403 for non-admin", async () => {
  authState = "forbidden";
  const { GET } = (await import("@/app/api/admin/slo/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/admin/slo"));
  assert.equal(res.status, 403);
});

test("GET /api/admin/slo returns 200 with SLO catalog and report", async () => {
  const { GET } = (await import("@/app/api/admin/slo/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/admin/slo"));
  assert.equal(res.status, 200);
  const body = await res.json() as { catalog: unknown; report: unknown };
  assert.ok(body.catalog, "catalog field present");
  assert.ok(body.report !== undefined, "report field present");
  // Response must be no-store to prevent caching of point-in-time SLO snapshots
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
});

// ===========================================================================
// GET /api/admin/stats
// ===========================================================================

test("GET /api/admin/stats returns 401 when not authenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/admin/stats/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/admin/stats"));
  assert.equal(res.status, 401);
});

test("GET /api/admin/stats returns 403 for non-admin", async () => {
  authState = "forbidden";
  const { GET } = (await import("@/app/api/admin/stats/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/admin/stats"));
  assert.equal(res.status, 403);
});

test("GET /api/admin/stats returns 200 with admin overview data", async () => {
  const { GET } = (await import("@/app/api/admin/stats/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/admin/stats"));
  assert.equal(res.status, 200);
  const body = await res.json() as typeof adminOverview;
  assert.deepEqual(body, adminOverview);
});
