/**
 * Route tests for PATCH/DELETE /api/admin/members/[id] (issue #995).
 *
 * Covers: tenant/capability, role mutation, self/last-admin protection,
 * cross-org isolation (via session boundary), delete/conflict/not-found.
 *
 * Mocks: @/lib/api-auth, @/lib/account-lifecycle, @/lib/result,
 *        @/lib/security/audit, @/lib/security/events, @/lib/security/client-ip.
 * No DB, no real auth, no network.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, jsonPatch, deleteReq, withParams } from "./support/route";
import { type AuthState, fullAuthExports, makeSession } from "./support/auth-mock";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let authState: AuthState = "ok";

type DomainOkRole = { ok: true; role: string; previousRole: string; changed: boolean };
type DomainOkDelete = { ok: true; role: string; ownedArticleCount: number };
type DomainErr = { ok: false; error: string; status: number };
type UpdateResult = DomainOkRole | DomainErr;
type DeleteResult = DomainOkDelete | DomainErr;

let updateResult: UpdateResult = { ok: true, role: "Reader", previousRole: "Admin", changed: true };
let deleteResult: DeleteResult = { ok: true, role: "Reader", ownedArticleCount: 0 };
let updateCallArgs: { id: string; role: string } | null = null;
let deleteCallArgs: { id: string } | null = null;
let securityEvents: Array<{ type: string }> = [];

const MEMBER_URL = "http://test/api/admin/members/member-1";

function patchRole(body: unknown) {
  return jsonPatch(MEMBER_URL, body);
}

async function loadHandlers(): Promise<{ PATCH: RouteHandler; DELETE: RouteHandler }> {
  const mod = (await import("@/app/api/admin/members/[id]/route")) as {
    PATCH: RouteHandler;
    DELETE: RouteHandler;
  };
  return mod;
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/account-lifecycle", {
    namedExports: {
      updateMemberRole: async (id: string, role: string) => {
        updateCallArgs = { id, role };
        return updateResult;
      },
      deleteMember: async (id: string) => {
        deleteCallArgs = { id };
        return deleteResult;
      },
    },
  });

  // Note: @/lib/result is NOT mocked — it uses the real throwIfFailed which
  // throws a real ApiError that the api-handler recognizes via instanceof.

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        adminMemberRoleUpdate: "admin.member.role_update",
        adminMemberDelete: "admin.member.delete",
        securityAdminAccessDenied: "security.admin_access_denied",
      },
      auditRequestInfo: () => ({ ipAddress: null, userAgent: null }),
      recordAuditFromRequest: async () => {},
      tryRecordAuditLog: async () => {},
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
  updateResult = { ok: true, role: "Reader", previousRole: "Admin", changed: true };
  deleteResult = { ok: true, role: "Reader", ownedArticleCount: 0 };
  updateCallArgs = null;
  deleteCallArgs = null;
  securityEvents = [];
});

// ---------------------------------------------------------------------------
// PATCH: Auth / capability
// ---------------------------------------------------------------------------

test("PATCH /api/admin/members/[id] returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { PATCH } = await loadHandlers();
  const res = await PATCH(patchRole({ role: "Reader" }), withParams({ id: "member-1" }));
  assert.equal(res.status, 401);
});

test("PATCH /api/admin/members/[id] returns 403 when lacking capability", async () => {
  authState = "forbidden";
  const { PATCH } = await loadHandlers();
  const res = await PATCH(patchRole({ role: "Reader" }), withParams({ id: "member-1" }));
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// PATCH: Input validation
// ---------------------------------------------------------------------------

test("PATCH /api/admin/members/[id] returns 400 for invalid role", async () => {
  const { PATCH } = await loadHandlers();
  const res = await PATCH(patchRole({ role: "SuperAdmin" }), withParams({ id: "member-1" }));
  assert.equal(res.status, 400);
});

test("PATCH /api/admin/members/[id] returns 400 for missing role", async () => {
  const { PATCH } = await loadHandlers();
  const res = await PATCH(patchRole({}), withParams({ id: "member-1" }));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// PATCH: Self / last-admin protection
// ---------------------------------------------------------------------------

test("PATCH /api/admin/members/[id] returns 409 when admin demotes self", async () => {
  // The admin session user id is "admin-1" (from adminSession in support/route.ts)
  const { PATCH } = await loadHandlers();
  const res = await PATCH(patchRole({ role: "Reader" }), withParams({ id: "admin-1" }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /cannot remove your own admin role/i);
});

test("PATCH /api/admin/members/[id] allows admin to keep own admin role", async () => {
  updateResult = { ok: true, role: "Admin", previousRole: "Admin", changed: false };
  const { PATCH } = await loadHandlers();
  const res = await PATCH(patchRole({ role: "Admin" }), withParams({ id: "admin-1" }));
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------------------
// PATCH: Success
// ---------------------------------------------------------------------------

test("PATCH /api/admin/members/[id] returns ok with new role on success", async () => {
  updateResult = { ok: true, role: "Reader", previousRole: "Admin", changed: true };
  const { PATCH } = await loadHandlers();
  const res = await PATCH(patchRole({ role: "Reader" }), withParams({ id: "member-1" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.role, "Reader");
  assert.deepEqual(updateCallArgs, { id: "member-1", role: "Reader" });
});

// ---------------------------------------------------------------------------
// PATCH: Not found / conflict
// ---------------------------------------------------------------------------

test("PATCH /api/admin/members/[id] returns 404 when member not found", async () => {
  updateResult = { ok: false, error: "Not found", status: 404 };
  const { PATCH } = await loadHandlers();
  const res = await PATCH(patchRole({ role: "Reader" }), withParams({ id: "missing" }));
  assert.equal(res.status, 404);
});

test("PATCH /api/admin/members/[id] returns 409 on last-admin conflict", async () => {
  updateResult = { ok: false, error: "Cannot demote the last remaining admin", status: 409 };
  const { PATCH } = await loadHandlers();
  const res = await PATCH(patchRole({ role: "Reader" }), withParams({ id: "other-admin" }));
  assert.equal(res.status, 409);
});

// ---------------------------------------------------------------------------
// DELETE: Auth / capability
// ---------------------------------------------------------------------------

test("DELETE /api/admin/members/[id] returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { DELETE } = await loadHandlers();
  const res = await DELETE(deleteReq(MEMBER_URL), withParams({ id: "member-1" }));
  assert.equal(res.status, 401);
});

test("DELETE /api/admin/members/[id] returns 403 when lacking capability", async () => {
  authState = "forbidden";
  const { DELETE } = await loadHandlers();
  const res = await DELETE(deleteReq(MEMBER_URL), withParams({ id: "member-1" }));
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// DELETE: Self-delete protection
// ---------------------------------------------------------------------------

test("DELETE /api/admin/members/[id] returns 409 when deleting self", async () => {
  const { DELETE } = await loadHandlers();
  const res = await DELETE(deleteReq(MEMBER_URL), withParams({ id: "admin-1" }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /cannot remove your own account/i);
});

// ---------------------------------------------------------------------------
// DELETE: Success
// ---------------------------------------------------------------------------

test("DELETE /api/admin/members/[id] returns ok on successful deletion", async () => {
  deleteResult = { ok: true, role: "Reader", ownedArticleCount: 3 };
  const { DELETE } = await loadHandlers();
  const res = await DELETE(deleteReq(MEMBER_URL), withParams({ id: "member-1" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(deleteCallArgs, { id: "member-1" });
});

// ---------------------------------------------------------------------------
// DELETE: Not found / conflict
// ---------------------------------------------------------------------------

test("DELETE /api/admin/members/[id] returns 404 when member not found", async () => {
  deleteResult = { ok: false, error: "Not found", status: 404 };
  const { DELETE } = await loadHandlers();
  const res = await DELETE(deleteReq(MEMBER_URL), withParams({ id: "missing" }));
  assert.equal(res.status, 404);
});

test("DELETE /api/admin/members/[id] returns 409 on last-admin conflict", async () => {
  deleteResult = { ok: false, error: "Cannot remove the last remaining admin", status: 409 };
  const { DELETE } = await loadHandlers();
  const res = await DELETE(deleteReq(MEMBER_URL), withParams({ id: "other-admin" }));
  assert.equal(res.status, 409);
});
