/**
 * Route tests for the content-governance APIs (RW-046..049): content sources
 * (list/toggle/sync), article review, and takedown. Verifies capability gating
 * (a session lacking the capability gets 403 and the lib is never called) and
 * the happy paths (lib invoked + audit recorded). All libs + auth + audit are
 * mocked — no DB, no real auth.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  getReq,
  jsonPatch,
  jsonPost,
  makeJsonRequest,
  readJson,
  type RouteHandler,
  withParams,
} from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

let authState: AuthState = "ok";
let auditCalls: { action: string }[] = [];

let toggleResult: unknown = null;
let toggleCalls: { key: string; enabled: boolean }[] = [];
let sourceLookupResult: unknown = null;
let recentRuns: unknown[] = [];
let syncCalls = 0;
let reviewResult: unknown = null;
let reviewCalls: unknown[] = [];
let takedownResult: unknown = null;
let takedownCalls: unknown[] = [];

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });
  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        adminSourceToggle: "admin.source.toggle",
        adminSourceSync: "admin.source.sync",
        adminArticleReview: "admin.article.review",
        adminArticleTakedown: "admin.article.takedown",
        securityAdminAccessDenied: "security.admin_access_denied",
      },
      auditRequestInfo: (req: Request) => ({
        ipAddress: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      }),
      recordAuditFromRequest: async (input: { action: string }) => {
        auditCalls.push(input);
      },
      tryRecordAuditLog: async (input: { action: string }) => {
        auditCalls.push(input);
      },
    },
  });
  mock.module("@/lib/cache", {
    namedExports: {
      revalidateArticlesCache: () => {},
      revalidateTagsCache: () => {},
    },
  });
  mock.module("@/lib/scraper/sources", {
    namedExports: {
      CRAWL_RUN_HISTORY_LIMIT: 25,
      CRAWL_RUN_HISTORY_API_MAX_LIMIT: 50,
      listContentSources: async () => [
        { id: "cs1", providerKey: "nbc", displayName: "NBC", enabled: true, healthStatus: "healthy" },
      ],
      getContentSource: async () => sourceLookupResult,
      listRecentCrawlRuns: async (_key: string, limit: number) => recentRuns.slice(0, limit),
      summarizeSourceHealth: () => ({ status: "healthy", flagged: false, reasons: [] }),
      setContentSourceEnabled: async (key: string, enabled: boolean) => {
        toggleCalls.push({ key, enabled });
        return toggleResult;
      },
      syncContentSources: async () => {
        syncCalls++;
        return { created: 1, updated: 3, total: 4 };
      },
    },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      ARTICLE_STATUSES: ["draft", "processing", "published", "failed", "archived"],
      TAKEDOWN_STATES: ["active", "unpublished", "archived", "takedown"],
      applyTakedown: async (input: unknown) => {
        takedownCalls.push(input);
        return takedownResult;
      },
      REVIEW_STATES: ["unreviewed", "approved", "needs_work", "rejected"],
      reviewArticle: async (input: unknown) => {
        reviewCalls.push(input);
        return reviewResult;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  auditCalls = [];
  toggleCalls = [];
  sourceLookupResult = { id: "cs1", providerKey: "nbc", displayName: "NBC", enabled: true };
  recentRuns = [
    {
      id: "run-1",
      providerKey: "nbc",
      source: "admin-trigger",
      mode: "provider",
      outcome: "success",
      durationMs: 42,
      discovered: 1,
      scraped: 1,
      failed: 0,
      duplicates: 0,
      rejected: 0,
      error: null,
      createdAt: new Date("2026-07-04T00:00:00Z"),
    },
  ];
  syncCalls = 0;
  reviewCalls = [];
  takedownCalls = [];
  toggleResult = { id: "cs1", providerKey: "nbc", displayName: "NBC", enabled: false };
  reviewResult = { ok: true, reviewState: "approved", changes: { title: { from: "a", to: "b" } } };
  takedownResult = {
    ok: true,
    previousState: "active",
    state: "takedown",
    status: "DRAFT",
  };
});

// ---- GET /api/admin/sources ----------------------------------------------

test("GET /api/admin/sources lists sources with health for a capable admin", async () => {
  const { GET } = (await import("@/app/api/admin/sources/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/admin/sources"));
  assert.equal(res.status, 200);
  const data = await readJson<{ sources: { health: unknown }[] }>(res);
  assert.equal(data.sources.length, 1);
  assert.ok("health" in data.sources[0]);
});

test("GET /api/admin/sources is forbidden without the capability", async () => {
  authState = "forbidden";
  const { GET } = (await import("@/app/api/admin/sources/route")) as { GET: RouteHandler };
  const res = await GET(getReq("http://test/api/admin/sources"));
  assert.equal(res.status, 403);
});

// ---- PATCH /api/admin/sources/[key] --------------------------------------

test("PATCH /api/admin/sources/[key] toggles + audits", async () => {
  const { PATCH } = (await import("@/app/api/admin/sources/[key]/route")) as {
    PATCH: RouteHandler;
  };
  const res = await PATCH(
    jsonPatch("http://test/api/admin/sources/nbc", { enabled: false }),
    withParams({ key: "nbc" }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(toggleCalls, [{ key: "nbc", enabled: false }]);
  assert.equal(auditCalls.at(-1)?.action, "admin.source.toggle");
});

test("PATCH /api/admin/sources/[key] returns 404 for an unknown provider", async () => {
  toggleResult = null;
  const { PATCH } = (await import("@/app/api/admin/sources/[key]/route")) as {
    PATCH: RouteHandler;
  };
  const res = await PATCH(
    jsonPatch("http://test/api/admin/sources/x", { enabled: true }),
    withParams({ key: "x" }),
  );
  assert.equal(res.status, 404);
});

test("GET /api/admin/sources/[key]/crawl-runs returns recent privacy-safe run summaries", async () => {
  const { GET } = (await import("@/app/api/admin/sources/[key]/crawl-runs/route")) as {
    GET: RouteHandler;
  };
  const res = await GET(
    getReq("http://test/api/admin/sources/nbc/crawl-runs?limit=1"),
    withParams({ key: "nbc" }),
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  const data = await readJson<{ runs: Array<Record<string, unknown>> }>(res);
  assert.equal(data.runs.length, 1);
  assert.equal(data.runs[0].source, "admin-trigger");
  assert.equal("url" in data.runs[0], false);
});

test("GET /api/admin/sources/[key]/crawl-runs returns 404 for an unknown source", async () => {
  sourceLookupResult = null;
  const { GET } = (await import("@/app/api/admin/sources/[key]/crawl-runs/route")) as {
    GET: RouteHandler;
  };
  const res = await GET(
    getReq("http://test/api/admin/sources/missing/crawl-runs"),
    withParams({ key: "missing" }),
  );
  assert.equal(res.status, 404);
});

// ---- POST /api/admin/sources/sync ----------------------------------------

test("POST /api/admin/sources/sync syncs + audits", async () => {
  const { POST } = (await import("@/app/api/admin/sources/sync/route")) as { POST: RouteHandler };
  const res = await POST(makeJsonRequest("http://test/api/admin/sources/sync", "POST"));
  assert.equal(res.status, 200);
  assert.equal(syncCalls, 1);
  assert.equal(auditCalls.at(-1)?.action, "admin.source.sync");
});

// ---- POST /api/admin/articles/[id]/review --------------------------------

test("POST /review applies a review + audits", async () => {
  const { POST } = (await import("@/app/api/admin/articles/[id]/review/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    jsonPost("http://test/api/admin/articles/a1/review", { reviewState: "approved" }),
    withParams({ id: "a1" }),
  );
  assert.equal(res.status, 200);
  assert.equal(reviewCalls.length, 1);
  assert.equal(auditCalls.at(-1)?.action, "admin.article.review");
});

test("POST /review is forbidden without content.moderate", async () => {
  authState = "forbidden";
  const { POST } = (await import("@/app/api/admin/articles/[id]/review/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    jsonPost("http://test/api/admin/articles/a1/review", { reviewState: "approved" }),
    withParams({ id: "a1" }),
  );
  assert.equal(res.status, 403);
  assert.equal(reviewCalls.length, 0);
});

test("POST /review surfaces the lib's structured 404", async () => {
  reviewResult = { ok: false, error: "Article not found", status: 404 };
  const { POST } = (await import("@/app/api/admin/articles/[id]/review/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    jsonPost("http://test/api/admin/articles/missing/review", { reviewState: "approved" }),
    withParams({ id: "missing" }),
  );
  assert.equal(res.status, 404);
});

// ---- POST /api/admin/articles/[id]/takedown ------------------------------

test("POST /takedown applies a takedown + audits", async () => {
  const { POST } = (await import("@/app/api/admin/articles/[id]/takedown/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    jsonPost("http://test/api/admin/articles/a1/takedown", { state: "takedown" }),
    withParams({ id: "a1" }),
  );
  assert.equal(res.status, 200);
  assert.equal(takedownCalls.length, 1);
  assert.equal(auditCalls.at(-1)?.action, "admin.article.takedown");
});

test("POST /takedown rejects an invalid state with 400", async () => {
  const { POST } = (await import("@/app/api/admin/articles/[id]/takedown/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    jsonPost("http://test/api/admin/articles/a1/takedown", { state: "bogus" }),
    withParams({ id: "a1" }),
  );
  assert.equal(res.status, 400);
  assert.equal(takedownCalls.length, 0);
});
