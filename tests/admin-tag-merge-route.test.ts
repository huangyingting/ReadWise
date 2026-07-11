/**
 * Route tests for POST /api/admin/tags/[id]/merge (issue #995).
 *
 * Covers: auth/capability, source/target validation, self-merge,
 * transactional reassignment/delete/audit semantics, conflict/not-found.
 *
 * Mocks: @/lib/api-auth, @/lib/admin/tags, @/lib/cache,
 *        @/lib/security/audit, @/lib/security/events, @/lib/security/client-ip.
 * No DB, no real auth, no network.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, jsonPost, withParams } from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";

type MergeResult = { ok: true; moved: number } | { ok: false; error: string; status: number };
let mergeResult: MergeResult = { ok: true, moved: 5 };
let mergeCallArgs: { sourceId: string; targetId: string } | null = null;
let auditCalls: Array<{ action: string }> = [];
let auditInputs: Array<Record<string, unknown>> = [];
let securityEvents: Array<{ type: string }> = [];
let cacheRevalidated = false;

const MERGE_URL = "http://test/api/admin/tags/source-tag-1/merge";

function mergeRequest(body: unknown) {
  return jsonPost(MERGE_URL, body);
}

async function loadPost(): Promise<RouteHandler> {
  const { POST } = (await import("@/app/api/admin/tags/[id]/merge/route")) as {
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

  mock.module("@/lib/admin/tags", {
    namedExports: {
      mergeTags: async (
        sourceId: string,
        targetId: string,
        auditCallback?: (result: { moved: number }) => unknown,
      ) => {
        mergeCallArgs = { sourceId, targetId };
        if (mergeResult.ok && auditCallback) {
          const input = auditCallback({ moved: mergeResult.moved });
          auditInputs.push(input as Record<string, unknown>);
        }
        return mergeResult;
      },
    },
  });

  mock.module("@/lib/cache", {
    namedExports: {
      revalidateTagsCache: () => {
        cacheRevalidated = true;
      },
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        adminTagMerge: "admin.tag.merge",
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
  mergeResult = { ok: true, moved: 5 };
  mergeCallArgs = null;
  auditCalls = [];
  auditInputs = [];
  securityEvents = [];
  cacheRevalidated = false;
});

// ---------------------------------------------------------------------------
// Auth / capability
// ---------------------------------------------------------------------------

test("POST /api/admin/tags/[id]/merge returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const POST = await loadPost();
  const res = await POST(mergeRequest({ targetId: "target-1" }), withParams({ id: "source-1" }));
  assert.equal(res.status, 401);
});

test("POST /api/admin/tags/[id]/merge returns 403 when lacking capability", async () => {
  authState = "forbidden";
  const POST = await loadPost();
  const res = await POST(mergeRequest({ targetId: "target-1" }), withParams({ id: "source-1" }));
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

test("POST /api/admin/tags/[id]/merge returns 400 for missing targetId", async () => {
  const POST = await loadPost();
  const res = await POST(mergeRequest({}), withParams({ id: "source-1" }));
  assert.equal(res.status, 400);
});

test("POST /api/admin/tags/[id]/merge returns 400 for empty targetId", async () => {
  const POST = await loadPost();
  const res = await POST(mergeRequest({ targetId: "" }), withParams({ id: "source-1" }));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Self-merge
// ---------------------------------------------------------------------------

test("POST /api/admin/tags/[id]/merge returns error for self-merge", async () => {
  mergeResult = { ok: false, error: "Cannot merge a tag into itself", status: 400 };
  const POST = await loadPost();
  const res = await POST(mergeRequest({ targetId: "source-1" }), withParams({ id: "source-1" }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Cannot merge a tag into itself/);
});

// ---------------------------------------------------------------------------
// Not found
// ---------------------------------------------------------------------------

test("POST /api/admin/tags/[id]/merge returns 404 when source not found", async () => {
  mergeResult = { ok: false, error: "Source tag not found", status: 404 };
  const POST = await loadPost();
  const res = await POST(mergeRequest({ targetId: "target-1" }), withParams({ id: "missing" }));
  assert.equal(res.status, 404);
});

test("POST /api/admin/tags/[id]/merge returns 404 when target not found", async () => {
  mergeResult = { ok: false, error: "Target tag not found", status: 404 };
  const POST = await loadPost();
  const res = await POST(mergeRequest({ targetId: "missing" }), withParams({ id: "source-1" }));
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// Success / transactional reassignment
// ---------------------------------------------------------------------------

test("POST /api/admin/tags/[id]/merge returns success with moved count", async () => {
  mergeResult = { ok: true, moved: 3 };
  const POST = await loadPost();
  const res = await POST(mergeRequest({ targetId: "target-1" }), withParams({ id: "source-1" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.moved, 3);
  assert.ok(cacheRevalidated);
});

test("POST /api/admin/tags/[id]/merge passes correct source and target ids", async () => {
  const POST = await loadPost();
  await POST(mergeRequest({ targetId: "target-42" }), withParams({ id: "src-99" }));
  assert.deepEqual(mergeCallArgs, { sourceId: "src-99", targetId: "target-42" });
});

// ---------------------------------------------------------------------------
// Audit callback
// ---------------------------------------------------------------------------

test("POST /api/admin/tags/[id]/merge invokes audit callback with merge metadata", async () => {
  mergeResult = { ok: true, moved: 8 };
  const POST = await loadPost();
  await POST(mergeRequest({ targetId: "target-1" }), withParams({ id: "source-1" }));
  assert.equal(auditInputs.length, 1);
  const audit = auditInputs[0];
  assert.equal(audit.action, "admin.tag.merge");
  assert.equal(audit.targetType, "tag");
  assert.equal(audit.targetId, "target-1");
  const meta = audit.metadata as Record<string, unknown>;
  assert.equal(meta.sourceTagId, "source-1");
  assert.equal(meta.moved, 8);
});

test("POST /api/admin/tags/[id]/merge audit metadata contains no private content", async () => {
  mergeResult = { ok: true, moved: 2 };
  const POST = await loadPost();
  await POST(mergeRequest({ targetId: "target-1" }), withParams({ id: "source-1" }));
  const audit = auditInputs[0];
  const meta = audit.metadata as Record<string, unknown>;
  assert.equal(Object.keys(meta).length, 2);
  assert.ok(!("userId" in meta));
  assert.ok(!("email" in meta));
  assert.ok(!("tagName" in meta));
});

test("POST /api/admin/tags/[id]/merge does not invoke audit callback on failure", async () => {
  mergeResult = { ok: false, error: "Source tag not found", status: 404 };
  const POST = await loadPost();
  await POST(mergeRequest({ targetId: "target-1" }), withParams({ id: "missing" }));
  assert.equal(auditInputs.length, 0);
});

test("POST /api/admin/tags/[id]/merge does not revalidate cache on failure", async () => {
  mergeResult = { ok: false, error: "Source tag not found", status: 404 };
  const POST = await loadPost();
  await POST(mergeRequest({ targetId: "target-1" }), withParams({ id: "missing" }));
  assert.equal(cacheRevalidated, false);
});
