/**
 * Route tests for POST /api/admin/articles/ingest (issue #995).
 *
 * Covers: auth/capability, input validation, success orchestration,
 * duplicate handling, provider failure, and safe error semantics.
 *
 * Mocks: @/lib/api-auth, @/lib/scraper, @/lib/cache, @/lib/article-library,
 *        @/lib/security/audit, @/lib/security/events, @/lib/security/client-ip.
 * No DB, no real auth, no network, no live URL fetch.
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

let scrapeResult: Record<string, unknown> | null = {
  title: "Test Article",
  sourceUrl: "https://example.com/article",
  text: "Body text that is long enough to pass validation checks.",
};
let scrapeError: Error | null = null;

let saveOutcome: {
  status: string;
  id?: string;
  sourceUrl?: string;
  failure?: string;
  reason?: string;
} = {
  status: "saved",
  id: "article-new",
};

let auditCalls: Array<{ action: string; targetId?: string }> = [];
let securityEvents: Array<{ type: string }> = [];
let cacheRevalidated = false;
let findExistingResult: { id: string } | null = { id: "existing-1" };

const INGEST_URL = "http://test/api/admin/articles/ingest";

function ingestRequest(body: unknown) {
  return jsonPost(INGEST_URL, body);
}

async function loadPost(): Promise<RouteHandler> {
  const { POST } = (await import("@/app/api/admin/articles/ingest/route")) as {
    POST: RouteHandler;
  };
  return POST;
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/scraper", {
    namedExports: {
      scrapeAndSave: async (
        url: string,
        auditInput: (created: { id: string }) => unknown,
      ) => {
        if (scrapeError) {
          return {
            status: "failed",
            failure: "scrape",
            reason: scrapeError instanceof Error ? scrapeError.message : String(scrapeError),
            sourceUrl: url,
          };
        }
        if (!scrapeResult) {
          return {
            status: "failed",
            failure: "extract",
            reason: "could not extract article content",
            sourceUrl: url,
          };
        }
        if (saveOutcome.status === "saved") {
          const auditArg = auditInput({ id: saveOutcome.id! });
          auditCalls.push(auditArg as { action: string; targetId?: string });
          return saveOutcome;
        }
        if (saveOutcome.status === "failed") {
          return {
            ...saveOutcome,
            failure: saveOutcome.failure ?? "save",
            sourceUrl: url,
          };
        }
        return saveOutcome;
      },
    },
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      findPublicLibraryArticleBySourceUrl: async () => findExistingResult,
      ARTICLE_STATUSES: ["DRAFT", "PUBLISHED", "ARCHIVED"],
      REVIEW_STATES: ["pending", "approved", "rejected"],
      TAKEDOWN_STATES: ["none", "pending", "taken_down"],
    },
  });

  mock.module("@/lib/cache", {
    namedExports: {
      revalidateArticlesCache: () => {
        cacheRevalidated = true;
      },
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        adminArticleIngest: "admin.article.ingest",
        securityAdminAccessDenied: "security.admin_access_denied",
      },
      auditRequestInfo: () => ({ ipAddress: null, userAgent: null }),
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
      recordSecurityEvent: (input: { type: string }) => {
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
});

beforeEach(() => {
  authState = "ok";
  scrapeResult = {
    title: "Test Article",
    sourceUrl: "https://example.com/article",
    text: "Body text",
  };
  scrapeError = null;
  saveOutcome = { status: "saved", id: "article-new" };
  auditCalls = [];
  securityEvents = [];
  cacheRevalidated = false;
  findExistingResult = { id: "existing-1" };
});

// ---------------------------------------------------------------------------
// Auth / capability
// ---------------------------------------------------------------------------

test("POST /api/admin/articles/ingest returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const POST = await loadPost();
  const res = await POST(ingestRequest({ url: "https://example.com" }), undefined);
  assert.equal(res.status, 401);
});

test("POST /api/admin/articles/ingest returns 403 when lacking capability", async () => {
  authState = "forbidden";
  const POST = await loadPost();
  const res = await POST(ingestRequest({ url: "https://example.com" }), undefined);
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

test("POST /api/admin/articles/ingest returns 400 for missing url", async () => {
  const POST = await loadPost();
  const res = await POST(ingestRequest({}), undefined);
  assert.equal(res.status, 400);
});

test("POST /api/admin/articles/ingest returns 400 for empty url", async () => {
  const POST = await loadPost();
  const res = await POST(ingestRequest({ url: "" }), undefined);
  assert.equal(res.status, 400);
});

test("POST /api/admin/articles/ingest returns 400 for url exceeding max length", async () => {
  const POST = await loadPost();
  const res = await POST(ingestRequest({ url: "https://x.com/" + "a".repeat(2000) }), undefined);
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Success orchestration
// ---------------------------------------------------------------------------

test("POST /api/admin/articles/ingest returns 201 on successful save", async () => {
  const POST = await loadPost();
  const res = await POST(ingestRequest({ url: "https://example.com/article" }), undefined);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, "saved");
  assert.equal(body.id, "article-new");
  assert.ok(cacheRevalidated);
});

test("POST /api/admin/articles/ingest invokes audit callback on success", async () => {
  const POST = await loadPost();
  await POST(ingestRequest({ url: "https://example.com/article" }), undefined);
  assert.ok(auditCalls.length > 0);
  assert.equal(auditCalls[0].action, "admin.article.ingest");
});

// ---------------------------------------------------------------------------
// Duplicate handling
// ---------------------------------------------------------------------------

test("POST /api/admin/articles/ingest returns 409 for duplicate", async () => {
  saveOutcome = { status: "skipped", sourceUrl: "https://example.com/article" };
  const POST = await loadPost();
  const res = await POST(ingestRequest({ url: "https://example.com/article" }), undefined);
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.status, "duplicate");
  assert.equal(body.id, "existing-1");
});

// ---------------------------------------------------------------------------
// Provider failure
// ---------------------------------------------------------------------------

test("POST /api/admin/articles/ingest returns 422 when scrape throws", async () => {
  scrapeError = new Error("Network timeout after private article sentence");
  const POST = await loadPost();
  const res = await POST(ingestRequest({ url: "https://example.com/fail" }), undefined);
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.match(body.error, /Scrape failed/);
  assert.doesNotMatch(body.error, /private article sentence|Network timeout/);
});

test("POST /api/admin/articles/ingest returns 422 when scrape returns null", async () => {
  scrapeResult = null;
  const POST = await loadPost();
  const res = await POST(ingestRequest({ url: "https://example.com/empty" }), undefined);
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.match(body.error, /Could not extract/);
});

test("POST /api/admin/articles/ingest returns 422 when save fails", async () => {
  saveOutcome = { status: "failed", reason: "DB constraint violation" };
  const POST = await loadPost();
  const res = await POST(ingestRequest({ url: "https://example.com/article" }), undefined);
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.match(body.error, /Save failed/);
});

test("POST /api/admin/articles/ingest returns a controlled error when intake is disabled", async () => {
  saveOutcome = { status: "failed", failure: "disabled" };
  const POST = await loadPost();
  const res = await POST(ingestRequest({ url: "https://example.com/article" }), undefined);

  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error, "Scraping is currently disabled.");
  assert.equal(typeof body.requestId, "string");
});

test("POST /api/admin/articles/ingest returns a controlled quality-rejection error", async () => {
  saveOutcome = { status: "failed", failure: "quality" };
  const POST = await loadPost();
  const res = await POST(ingestRequest({ url: "https://example.com/article" }), undefined);

  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error, "The article did not pass content quality checks.");
  assert.equal(typeof body.requestId, "string");
});

// ---------------------------------------------------------------------------
// Safe errors
// ---------------------------------------------------------------------------

test("POST /api/admin/articles/ingest replaces scrape exception prose with a controlled message", async () => {
  scrapeError = new Error("Connection refused");
  const POST = await loadPost();
  const res = await POST(ingestRequest({ url: "https://example.com/fail" }), undefined);
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error, "Scrape failed. The article could not be fetched.");
});

test("POST /api/admin/articles/ingest does not surface non-Error scrape failures", async () => {
  scrapeError = "private selected text" as unknown as Error;
  const POST = await loadPost();
  const res = await POST(ingestRequest({ url: "https://example.com/fail" }), undefined);
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error, "Scrape failed. The article could not be fetched.");
});
