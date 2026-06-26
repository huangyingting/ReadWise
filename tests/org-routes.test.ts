/**
 * HTTP route tests for org membership endpoints (RW-060).
 * TEST2-1, TEST2-2
 *
 * Covers:
 *   POST /api/orgs/[id]/members — 401, 403 (wrong org capability), 201
 *
 * Mocks: @/lib/api-auth, @/lib/org, @/lib/classroom — no DB or real auth.
 * @/lib/tenant-api is NOT mocked; the real requireOrgCapabilityApi runs against
 * the mocked @/lib/org dependencies so real ApiError throws are exercised.
 *
 * NOTE: Do NOT import anything from @/lib/api-handler at the top level —
 * doing so eagerly loads @/lib/api-auth before the mock is registered.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, readerSession, withParams, jsonPost } from "./support/route";

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

type AuthState = "ok" | "unauth";
let authState: AuthState = "ok";

// org stubs — control requireOrgCapabilityApi via the real org barrel
let membershipStub: { role: string } | null = null;
let isOrgAdminStub = false;

// addMember result
let addMemberResult: Record<string, unknown> = {
  id: "mem1",
  userId: "u2",
  orgId: "org-1",
  role: "Member",
};

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () => {
        if (authState === "unauth") {
          return {
            error: new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "content-type": "application/json" },
            }),
          };
        }
        return { session: readerSession };
      },
    },
  });

  // @/lib/org barrel — used by the real requireOrgCapabilityApi (in tenant-api) and
  // also by the org/[id]/members route handler itself (addMember).
  mock.module("@/lib/org", {
    namedExports: {
      getMembership: async () => membershipStub,
      hasOrgCapability: () => isOrgAdminStub,
      isSystemAdmin: () => false,
      addMember: async () => addMemberResult,
    },
  });

  // @/lib/classroom barrel — required by the real @/lib/tenant-api import chain
  // (it imports canManageClassroom + getClassroom). We never call those functions
  // from this test file but they must be present to satisfy ESM named binding.
  mock.module("@/lib/classroom", {
    namedExports: {
      canManageClassroom: () => false,
      getClassroom: async () => null,
      createClassroom: async () => null,
      addClassroomMember: async () => null,
      assignArticle: async () => null,
      getStudentAssignmentContext: async () => null,
      recordAssignmentCompletion: async () => null,
    },
  });
});

beforeEach(() => {
  authState = "ok";
  membershipStub = null;
  isOrgAdminStub = false;
  addMemberResult = { id: "mem1", userId: "u2", orgId: "org-1", role: "Member" };
});

// ===========================================================================
// POST /api/orgs/[id]/members
// ===========================================================================

test("POST /api/orgs/[id]/members returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/orgs/[id]/members/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/orgs/org-1/members", { userId: "u2", role: "Member" }),
    withParams({ id: "org-1" }),
  );
  assert.equal(res.status, 401);
});

test("POST /api/orgs/[id]/members returns 403 when caller lacks org membership management capability", async () => {
  // membershipStub=null + isOrgAdminStub=false → real requireOrgCapabilityApi throws 403
  membershipStub = null;
  isOrgAdminStub = false;
  const { POST } = (await import("@/app/api/orgs/[id]/members/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/orgs/org-1/members", { userId: "u2", role: "Member" }),
    withParams({ id: "org-1" }),
  );
  assert.equal(res.status, 403);
  const body = await res.json() as { error: string };
  assert.ok(typeof body.error === "string");
});

test("POST /api/orgs/[id]/members returns 201 with new membership on success", async () => {
  // isOrgAdminStub=true → real requireOrgCapabilityApi passes
  isOrgAdminStub = true;
  const { POST } = (await import("@/app/api/orgs/[id]/members/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/orgs/org-1/members", { userId: "u2", role: "Member" }),
    withParams({ id: "org-1" }),
  );
  assert.equal(res.status, 201);
  const body = await res.json() as { ok: boolean; membership: { id: string } };
  assert.equal(body.ok, true);
  assert.equal(body.membership.id, "mem1");
});
