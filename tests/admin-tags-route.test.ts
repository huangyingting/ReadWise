/**
 * Route tests for admin tag management: PATCH and DELETE /api/admin/tags/[id]
 * (issue #1001 batch 1).
 *
 * Covers: auth/capability (tagsManage), rename success/conflict/not-found,
 * delete success/not-found, cache revalidation, audit callback invocation.
 *
 * Mocks: @/lib/api-auth, @/lib/admin/tags, @/lib/cache,
 *        @/lib/security/audit, @/lib/security/events, @/lib/security/client-ip.
 * No DB, no real auth, no network.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  type RouteHandler,
  jsonPatch,
  deleteReq,
  withParams,
} from "./support/route";
import { type AuthState, fullAuthExports } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";

type RenameResult = { ok: true; changed: boolean } | { ok: false; error: string; status: number };
type DeleteResult = { ok: true; articleCount: number } | { ok: false; error: string; status: number };

let renameResult: RenameResult = { ok: true, changed: true };
let deleteResult: DeleteResult = { ok: true, articleCount: 3 };
let renameCallArgs: { id: string; name: string } | null = null;
let deleteCallArgs: { id: string } | null = null;
let auditCalls: Array<Record<string, unknown>> = [];
let cacheRevalidated = false;

const TAG_URL = "http://test/api/admin/tags/tag-1";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/admin/tags", {
    namedExports: {
      renameTag: async (
        id: string,
        name: string,
        auditCallback?: (result: { changed: boolean }) => unknown,
      ) => {
        renameCallArgs = { id, name };
        if (renameResult.ok && auditCallback) {
          const input = auditCallback({ changed: renameResult.changed });
          auditCalls.push(input as Record<string, unknown>);
        }
        return renameResult;
      },
      deleteTag: async (
        id: string,
        auditCallback?: (result: { articleCount: number }) => unknown,
      ) => {
        deleteCallArgs = { id };
        if (deleteResult.ok && auditCallback) {
          const input = auditCallback({ articleCount: deleteResult.articleCount });
          auditCalls.push(input as Record<string, unknown>);
        }
        return deleteResult;
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
        adminTagRename: "admin.tag.rename",
        adminTagDelete: "admin.tag.delete",
        securityAdminAccessDenied: "security.admin_access_denied",
      },
      auditRequestInfo: () => ({ ipAddress: null, userAgent: null }),
      recordAuditFromRequest: async (input: Record<string, unknown>) => {
        auditCalls.push(input);
      },
      tryRecordAuditLog: async (input: Record<string, unknown>) => {
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
      recordSecurityEvent: () => {},
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
  renameResult = { ok: true, changed: true };
  deleteResult = { ok: true, articleCount: 3 };
  renameCallArgs = null;
  deleteCallArgs = null;
  auditCalls = [];
  cacheRevalidated = false;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadPatch(): Promise<RouteHandler> {
  const { PATCH } = (await import("@/app/api/admin/tags/[id]/route")) as { PATCH: RouteHandler };
  return PATCH;
}

async function loadDelete(): Promise<RouteHandler> {
  const { DELETE } = (await import("@/app/api/admin/tags/[id]/route")) as { DELETE: RouteHandler };
  return DELETE;
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/tags/[id] — rename
// ---------------------------------------------------------------------------

test("PATCH /admin/tags/[id] returns 401 for unauthenticated", async () => {
  authState = "unauth";
  const handler = await loadPatch();
  const res = await handler(jsonPatch(TAG_URL, { name: "New" }), withParams({ id: "tag-1" }));
  assert.equal(res.status, 401);
});

test("PATCH /admin/tags/[id] returns 403 for non-admin", async () => {
  authState = "forbidden";
  const handler = await loadPatch();
  const res = await handler(jsonPatch(TAG_URL, { name: "New" }), withParams({ id: "tag-1" }));
  assert.equal(res.status, 403);
});

test("PATCH /admin/tags/[id] returns 400 for missing name", async () => {
  const handler = await loadPatch();
  const res = await handler(jsonPatch(TAG_URL, {}), withParams({ id: "tag-1" }));
  assert.equal(res.status, 400);
});

test("PATCH /admin/tags/[id] renames tag and revalidates cache", async () => {
  const handler = await loadPatch();
  const res = await handler(jsonPatch(TAG_URL, { name: "Renamed" }), withParams({ id: "tag-1" }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(renameCallArgs?.id, "tag-1");
  assert.equal(renameCallArgs?.name, "Renamed");
  assert.equal(cacheRevalidated, true);
});

test("PATCH /admin/tags/[id] invokes audit callback with rename metadata", async () => {
  const handler = await loadPatch();
  await handler(jsonPatch(TAG_URL, { name: "Renamed" }), withParams({ id: "tag-1" }));
  assert.ok(auditCalls.length >= 1);
  const audit = auditCalls[0];
  assert.equal(audit.action, "admin.tag.rename");
  assert.equal(audit.targetType, "tag");
  assert.equal(audit.targetId, "tag-1");
  assert.deepEqual(audit.metadata, { changed: true });
});

test("PATCH /admin/tags/[id] returns 409 on conflict", async () => {
  renameResult = { ok: false, error: "slug collision", status: 409 };
  const handler = await loadPatch();
  const res = await handler(jsonPatch(TAG_URL, { name: "Duplicate" }), withParams({ id: "tag-1" }));
  assert.equal(res.status, 409);
});

test("PATCH /admin/tags/[id] returns 404 when tag not found", async () => {
  renameResult = { ok: false, error: "Not found", status: 404 };
  const handler = await loadPatch();
  const res = await handler(jsonPatch(TAG_URL, { name: "X" }), withParams({ id: "tag-1" }));
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/tags/[id]
// ---------------------------------------------------------------------------

test("DELETE /admin/tags/[id] returns 401 for unauthenticated", async () => {
  authState = "unauth";
  const handler = await loadDelete();
  const res = await handler(deleteReq(TAG_URL), withParams({ id: "tag-1" }));
  assert.equal(res.status, 401);
});

test("DELETE /admin/tags/[id] returns 403 for non-admin", async () => {
  authState = "forbidden";
  const handler = await loadDelete();
  const res = await handler(deleteReq(TAG_URL), withParams({ id: "tag-1" }));
  assert.equal(res.status, 403);
});

test("DELETE /admin/tags/[id] deletes tag and revalidates cache", async () => {
  const handler = await loadDelete();
  const res = await handler(deleteReq(TAG_URL), withParams({ id: "tag-1" }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(deleteCallArgs?.id, "tag-1");
  assert.equal(cacheRevalidated, true);
});

test("DELETE /admin/tags/[id] invokes audit callback with delete metadata", async () => {
  const handler = await loadDelete();
  await handler(deleteReq(TAG_URL), withParams({ id: "tag-1" }));
  assert.ok(auditCalls.length >= 1);
  const audit = auditCalls[0];
  assert.equal(audit.action, "admin.tag.delete");
  assert.equal(audit.targetType, "tag");
  assert.equal(audit.targetId, "tag-1");
  assert.deepEqual(audit.metadata, { articleCount: 3 });
});

test("DELETE /admin/tags/[id] returns 404 when tag not found", async () => {
  deleteResult = { ok: false, error: "Not found", status: 404 };
  const handler = await loadDelete();
  const res = await handler(deleteReq(TAG_URL), withParams({ id: "tag-1" }));
  assert.equal(res.status, 404);
});
