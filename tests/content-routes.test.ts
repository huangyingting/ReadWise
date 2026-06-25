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
import { NextResponse } from "next/server";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

let authState: "ok" | "unauth" | "forbidden" = "ok";
let auditCalls: { action: string }[] = [];

let toggleResult: unknown = null;
let toggleCalls: { key: string; enabled: boolean }[] = [];
let syncCalls = 0;
let reviewResult: unknown = null;
let reviewCalls: unknown[] = [];
let takedownResult: unknown = null;
let takedownCalls: unknown[] = [];

const session = { user: { id: "admin-1", role: "Admin", name: "Admin", email: null } };
const readerSession = { user: { id: "reader-1", role: "Reader", name: "Reader", email: null } };

function gate() {
  if (authState === "unauth") {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (authState === "forbidden") {
    return {
      session: readerSession,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session };
}

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () => gate(),
      requireAdminApi: async () => gate(),
      requireCapabilityApi: async () => gate(),
    },
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
  mock.module("@/lib/content-sources", {
    namedExports: {
      listContentSources: async () => [
        { id: "cs1", providerKey: "nbc", displayName: "NBC", enabled: true, healthStatus: "healthy" },
      ],
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

function jsonReq(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---- GET /api/admin/sources ----------------------------------------------

test("GET /api/admin/sources lists sources with health for a capable admin", async () => {
  const { GET } = (await import("@/app/api/admin/sources/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/admin/sources"));
  assert.equal(res.status, 200);
  const data = (await res.json()) as { sources: { health: unknown }[] };
  assert.equal(data.sources.length, 1);
  assert.ok("health" in data.sources[0]);
});

test("GET /api/admin/sources is forbidden without the capability", async () => {
  authState = "forbidden";
  const { GET } = (await import("@/app/api/admin/sources/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/admin/sources"));
  assert.equal(res.status, 403);
});

// ---- PATCH /api/admin/sources/[key] --------------------------------------

test("PATCH /api/admin/sources/[key] toggles + audits", async () => {
  const { PATCH } = (await import("@/app/api/admin/sources/[key]/route")) as {
    PATCH: RouteHandler;
  };
  const res = await PATCH(jsonReq("http://test/api/admin/sources/nbc", { enabled: false }, "PATCH"), {
    params: Promise.resolve({ key: "nbc" }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(toggleCalls, [{ key: "nbc", enabled: false }]);
  assert.equal(auditCalls.at(-1)?.action, "admin.source.toggle");
});

test("PATCH /api/admin/sources/[key] returns 404 for an unknown provider", async () => {
  toggleResult = null;
  const { PATCH } = (await import("@/app/api/admin/sources/[key]/route")) as {
    PATCH: RouteHandler;
  };
  const res = await PATCH(jsonReq("http://test/api/admin/sources/x", { enabled: true }, "PATCH"), {
    params: Promise.resolve({ key: "x" }),
  });
  assert.equal(res.status, 404);
});

// ---- POST /api/admin/sources/sync ----------------------------------------

test("POST /api/admin/sources/sync syncs + audits", async () => {
  const { POST } = (await import("@/app/api/admin/sources/sync/route")) as { POST: RouteHandler };
  const res = await POST(new Request("http://test/api/admin/sources/sync", { method: "POST" }));
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
    jsonReq("http://test/api/admin/articles/a1/review", { reviewState: "approved" }),
    { params: Promise.resolve({ id: "a1" }) },
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
    jsonReq("http://test/api/admin/articles/a1/review", { reviewState: "approved" }),
    { params: Promise.resolve({ id: "a1" }) },
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
    jsonReq("http://test/api/admin/articles/missing/review", { reviewState: "approved" }),
    { params: Promise.resolve({ id: "missing" }) },
  );
  assert.equal(res.status, 404);
});

// ---- POST /api/admin/articles/[id]/takedown ------------------------------

test("POST /takedown applies a takedown + audits", async () => {
  const { POST } = (await import("@/app/api/admin/articles/[id]/takedown/route")) as {
    POST: RouteHandler;
  };
  const res = await POST(
    jsonReq("http://test/api/admin/articles/a1/takedown", { state: "takedown" }),
    { params: Promise.resolve({ id: "a1" }) },
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
    jsonReq("http://test/api/admin/articles/a1/takedown", { state: "bogus" }),
    { params: Promise.resolve({ id: "a1" }) },
  );
  assert.equal(res.status, 400);
  assert.equal(takedownCalls.length, 0);
});
