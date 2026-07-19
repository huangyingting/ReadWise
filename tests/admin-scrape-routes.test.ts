/**
 * HTTP route tests for admin scrape trigger + admin slo + admin stats (admin cluster).
 * TEST2-5, TEST2-14
 *
 * Covers:
 *   POST /api/admin/scrape/trigger — 401, 403, 400 (unknown provider), 400 (neither
 *                                    provider nor all), 400 (unsupported/unknown mode),
 *                                    incremental happy path; asserts an incremental run is
 *                                    requested (never a synchronous scrape), audit metadata
 *                                    (mode/providers/counts, no URLs), and security event.
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
let auditThrows = false;

// Security event captures
let securityEvents: { type: string; severity?: string }[] = [];

// Incremental-run-request stub
let requestedRunCalls: Array<{ providerKeys: string[]; now: Date }> = [];
let sourcesRequestedPerProvider = 2;

// SLO stub
const sloReport = { slis: [], ok: true };
const sliCatalog = [{ id: "test-sli", description: "Test SLI", slo: 0.999 }];

// Admin stats stub
const adminOverview = {
  articles: { total: 10, published: 8 },
  users: { total: 5 },
};

const SCRAPE_TRIGGER_URL = "http://test/api/admin/scrape/trigger";
const ADMIN_SLO_URL = "http://test/api/admin/slo";
const ADMIN_STATS_URL = "http://test/api/admin/stats";

function scrapeTriggerRequest(body: Record<string, unknown>) {
  return jsonPost(SCRAPE_TRIGGER_URL, body);
}

async function loadScrapeTriggerPost(): Promise<RouteHandler> {
  const { POST } = (await import("@/app/api/admin/scrape/trigger/route")) as { POST: RouteHandler };
  return POST;
}

async function loadAdminSloGet(): Promise<RouteHandler> {
  const { GET } = (await import("@/app/api/admin/slo/route")) as { GET: RouteHandler };
  return GET;
}

async function loadAdminStatsGet(): Promise<RouteHandler> {
  const { GET } = (await import("@/app/api/admin/stats/route")) as { GET: RouteHandler };
  return GET;
}

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

  mock.module("@/lib/scraper/incremental/incremental-run-request", {
    namedExports: {
      requestIncrementalRun: async (providerKeys: string[], now: Date) => {
        requestedRunCalls.push({ providerKeys: [...providerKeys], now });
        return { requested: sourcesRequestedPerProvider };
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
        if (auditThrows) throw new Error("audit unavailable");
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
  mock.module("@/lib/admin/overview", {
    namedExports: {
      getAdminOverview: async () => adminOverview,
    },
  });
});

beforeEach(() => {
  authState = "ok";
  auditCalls = [];
  auditThrows = false;
  securityEvents = [];
  requestedRunCalls = [];
  sourcesRequestedPerProvider = 2;
});

// ===========================================================================
// POST /api/admin/scrape/trigger
// ===========================================================================

test("POST /api/admin/scrape/trigger returns 401 when not authenticated", async () => {
  authState = "unauth";
  const POST = await loadScrapeTriggerPost();
  const res = await POST(scrapeTriggerRequest({ provider: "test-provider" }));
  assert.equal(res.status, 401);
});

test("POST /api/admin/scrape/trigger returns 403 when authenticated but non-admin", async () => {
  authState = "forbidden";
  const POST = await loadScrapeTriggerPost();
  const res = await POST(scrapeTriggerRequest({ provider: "test-provider" }));
  assert.equal(res.status, 403);
});

test("POST /api/admin/scrape/trigger returns 400 for an unknown provider key", async () => {
  const POST = await loadScrapeTriggerPost();
  const res = await POST(scrapeTriggerRequest({ provider: "nonexistent" }));
  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.match(body.error, /Unknown provider/i);
});

test("POST /api/admin/scrape/trigger returns 400 when neither provider nor all is set", async () => {
  const POST = await loadScrapeTriggerPost();
  const res = await POST(scrapeTriggerRequest({}));
  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.ok(typeof body.error === "string");
});

test("POST /api/admin/scrape/trigger happy path returns 200 with incremental results summary", async () => {
  const POST = await loadScrapeTriggerPost();
  const res = await POST(scrapeTriggerRequest({ provider: "test-provider", limit: 5 }));
  assert.equal(res.status, 200);
  const body = await res.json() as {
    ok: boolean;
    mode: string;
    results: { provider: string; sourcesRequested: number }[];
    totalSourcesRequested: number;
    note: string;
  };
  assert.equal(body.ok, true);
  assert.equal(body.mode, "incremental");
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].provider, "test-provider");
  assert.equal(body.results[0].sourcesRequested, 2);
  assert.equal(body.totalSourcesRequested, 2);
});

test("POST /api/admin/scrape/trigger requests an incremental run for the provider (never synchronous scrape)", async () => {
  const POST = await loadScrapeTriggerPost();
  await POST(scrapeTriggerRequest({ provider: "test-provider", limit: 5 }));

  assert.equal(requestedRunCalls.length, 1);
  assert.deepEqual(requestedRunCalls[0].providerKeys, ["test-provider"]);
  // The request carries only provider keys — no URL or article content crosses the seam.
  assert.equal(JSON.stringify(requestedRunCalls[0]).includes("http"), false);
});

test("POST /api/admin/scrape/trigger defaults to incremental mode when mode is omitted", async () => {
  const POST = await loadScrapeTriggerPost();
  const res = await POST(scrapeTriggerRequest({ provider: "test-provider" }));
  const body = await res.json() as { mode: string };
  assert.equal(body.mode, "incremental");
});

test("POST /api/admin/scrape/trigger explicitly rejects backfill mode (Phase 3)", async () => {
  const POST = await loadScrapeTriggerPost();
  const res = await POST(scrapeTriggerRequest({ provider: "test-provider", mode: "backfill" }));
  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.match(body.error, /not implemented/i);
  // Nothing was enqueued — the request fails closed, not through to old behavior.
  assert.equal(requestedRunCalls.length, 0);
});

test("POST /api/admin/scrape/trigger explicitly rejects force-rescrape mode (Phase 3)", async () => {
  const POST = await loadScrapeTriggerPost();
  const res = await POST(scrapeTriggerRequest({ provider: "test-provider", mode: "force-rescrape" }));
  assert.equal(res.status, 400);
  assert.equal(requestedRunCalls.length, 0);
});

test("POST /api/admin/scrape/trigger rejects an unknown mode string at validation", async () => {
  const POST = await loadScrapeTriggerPost();
  const res = await POST(scrapeTriggerRequest({ provider: "test-provider", mode: "bogus" }));
  assert.equal(res.status, 400);
  assert.equal(requestedRunCalls.length, 0);
});

test("POST /api/admin/scrape/trigger reports zero when no claimable source matches", async () => {
  sourcesRequestedPerProvider = 0;
  const POST = await loadScrapeTriggerPost();
  const res = await POST(scrapeTriggerRequest({ provider: "test-provider" }));
  assert.equal(res.status, 200);
  const body = await res.json() as { totalSourcesRequested: number; note: string };
  assert.equal(body.totalSourcesRequested, 0);
  assert.match(body.note, /no claimable/i);
});

test("POST /api/admin/scrape/trigger records an audit event with controlled metadata only", async () => {
  const POST = await loadScrapeTriggerPost();
  await POST(scrapeTriggerRequest({ provider: "test-provider", limit: 7 }));
  const scrapeAudit = auditCalls.find(
    (c) => (c as { action: string }).action === "admin.scrape.trigger",
  ) as { action: string; metadata: Record<string, unknown> } | undefined;
  assert.ok(scrapeAudit, "audit event admin.scrape.trigger should be recorded");
  assert.equal(scrapeAudit.metadata.mode, "incremental");
  assert.equal(scrapeAudit.metadata.providerCount, 1);
  assert.deepEqual(scrapeAudit.metadata.providers, ["test-provider"]);
  assert.equal(scrapeAudit.metadata.sourcesRequested, 2);
  assert.equal(scrapeAudit.metadata.limit, 7);
  // Audit metadata must never contain URLs or article content.
  assert.equal(JSON.stringify(scrapeAudit.metadata).includes("http"), false);
});

test("POST /api/admin/scrape/trigger rethrows unexpected trigger failures", async () => {
  const POST = await loadScrapeTriggerPost();
  auditThrows = true;
  const res = await POST(scrapeTriggerRequest({ provider: "test-provider" }));
  assert.equal(res.status, 500);
});

test("POST /api/admin/scrape/trigger records a security event on successful admin mutation", async () => {
  const POST = await loadScrapeTriggerPost();
  await POST(scrapeTriggerRequest({ provider: "test-provider" }));
  const mutation = securityEvents.find((e) => e.type === "admin.mutation");
  assert.ok(mutation, "security event admin.mutation should be recorded for successful admin POST");
});

test("POST /api/admin/scrape/trigger with all:true requests a run for all providers", async () => {
  const POST = await loadScrapeTriggerPost();
  const res = await POST(scrapeTriggerRequest({ all: true }));
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
  const GET = await loadAdminSloGet();
  const res = await GET(new Request(ADMIN_SLO_URL));
  assert.equal(res.status, 401);
});

test("GET /api/admin/slo returns 403 for non-admin", async () => {
  authState = "forbidden";
  const GET = await loadAdminSloGet();
  const res = await GET(new Request(ADMIN_SLO_URL));
  assert.equal(res.status, 403);
});

test("GET /api/admin/slo returns 200 with SLO catalog and report", async () => {
  const GET = await loadAdminSloGet();
  const res = await GET(new Request(ADMIN_SLO_URL));
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
  const GET = await loadAdminStatsGet();
  const res = await GET(new Request(ADMIN_STATS_URL));
  assert.equal(res.status, 401);
});

test("GET /api/admin/stats returns 403 for non-admin", async () => {
  authState = "forbidden";
  const GET = await loadAdminStatsGet();
  const res = await GET(new Request(ADMIN_STATS_URL));
  assert.equal(res.status, 403);
});

test("GET /api/admin/stats returns 200 with admin overview data", async () => {
  const GET = await loadAdminStatsGet();
  const res = await GET(new Request(ADMIN_STATS_URL));
  assert.equal(res.status, 200);
  const body = await res.json() as typeof adminOverview;
  assert.deepEqual(body, adminOverview);
});
