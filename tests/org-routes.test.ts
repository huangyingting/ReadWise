/**
 * HTTP route tests for organization lifecycle endpoints (RW-060).
 *
 * Covers:
 *   GET    /api/orgs
 *   GET    /api/orgs/[id]
 *   GET    /api/orgs/[id]/members
 *   POST   /api/orgs/[id]/members
 *   PATCH  /api/orgs/[id]/members/[memberId]
 *   DELETE /api/orgs/[id]/members/[memberId]
 *
 * Mocks: @/lib/api-auth, @/lib/org (+ org/classroom submodules used by
 * @/lib/tenant-api) — no DB or real auth.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  type RouteHandler,
  readerSession,
  withParams,
  getReq,
  jsonPost,
  jsonPatch,
  deleteReq,
} from "./support/route";

type AuthState = "ok" | "unauth";
let authState: AuthState = "ok";

let membershipStub: { role: string } | null = null;
let isOrgAdminStub = false;
let isSystemAdminStub = false;

let addMemberResult: Record<string, unknown> = {
  id: "mem1",
  userId: "u2",
  orgId: "org-1",
  role: "Member",
};
let listUserOrganizationsResult: Array<Record<string, unknown>> = [];
let getOrganizationResult: Record<string, unknown> | null = { id: "org-1", slug: "readwise", name: "ReadWise" };
let listOrgMembersResult: Array<Record<string, unknown>> = [];
let updateMemberRoleResult: { ok: true; role: string } | { ok: false; status: number; error: string } = {
  ok: true,
  role: "Teacher",
};
let removeMemberResult: { ok: true } | { ok: false; status: number; error: string } = { ok: true };

let updateMemberRoleArgs: { orgId: string; memberId: string; role: string } | null = null;
let removeMemberArgs: { orgId: string; memberId: string } | null = null;

const ORG_MEMBERS_MANAGE_CAPABILITY = "org.members.manage";

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

  mock.module("@/lib/org", {
    namedExports: {
      createOrganization: async () => ({
        organization: { id: "org-created", name: "Created Org", slug: "created-org" },
        membership: { id: "m-created", orgId: "org-created", userId: "user-1", role: "OrgAdmin" },
      }),
      listUserOrganizations: async () => listUserOrganizationsResult,
      getOrganization: async () => getOrganizationResult,
      listOrgMembers: async () => listOrgMembersResult,
      addMember: async () => addMemberResult,
      updateMemberRole: async (orgId: string, memberId: string, role: string) => {
        updateMemberRoleArgs = { orgId, memberId, role };
        return updateMemberRoleResult;
      },
      removeMember: async (orgId: string, memberId: string) => {
        removeMemberArgs = { orgId, memberId };
        return removeMemberResult;
      },
    },
  });

  mock.module("@/lib/org/queries", {
    namedExports: {
      getMembership: async () => membershipStub,
    },
  });

  mock.module("@/lib/org/guards", {
    namedExports: {
      hasOrgCapability: (
        membership: { role: string } | null | undefined,
        capability: string,
      ) => {
        if (!membership) return false;
        if (capability === ORG_MEMBERS_MANAGE_CAPABILITY) return isOrgAdminStub;
        return true;
      },
      isSystemAdmin: () => isSystemAdminStub,
    },
  });

  mock.module("@/lib/classroom/guards", {
    namedExports: {
      canManageClassroom: () => false,
    },
  });
  mock.module("@/lib/classroom/queries", {
    namedExports: {
      getClassroom: async () => null,
    },
  });
});

beforeEach(() => {
  authState = "ok";
  membershipStub = null;
  isOrgAdminStub = false;
  isSystemAdminStub = false;

  addMemberResult = { id: "mem1", userId: "u2", orgId: "org-1", role: "Member" };
  listUserOrganizationsResult = [
    { id: "m1", orgId: "org-1", userId: "user-1", role: "Teacher", org: { id: "org-1", name: "ReadWise" } },
  ];
  getOrganizationResult = { id: "org-1", slug: "readwise", name: "ReadWise" };
  listOrgMembersResult = [
    { userId: "user-1", role: "OrgAdmin", user: { id: "user-1", name: "Teacher", email: "t@e.com", image: null } },
    { userId: "u2", role: "Member", user: { id: "u2", name: "Member", email: "m@e.com", image: null } },
  ];
  updateMemberRoleResult = { ok: true, role: "Teacher" };
  removeMemberResult = { ok: true };
  updateMemberRoleArgs = null;
  removeMemberArgs = null;
});

async function getOrgs() {
  const { GET } = (await import("@/app/api/orgs/route")) as { GET: RouteHandler };
  return GET(getReq("http://test/api/orgs"));
}

async function getOrg(id = "org-1") {
  const { GET } = (await import("@/app/api/orgs/[id]/route")) as { GET: RouteHandler };
  return GET(getReq(`http://test/api/orgs/${id}`), withParams({ id }));
}

async function getOrgMembers(id = "org-1") {
  const { GET } = (await import("@/app/api/orgs/[id]/members/route")) as { GET: RouteHandler };
  return GET(getReq(`http://test/api/orgs/${id}/members`), withParams({ id }));
}

async function postOrgMember() {
  const { POST } = (await import("@/app/api/orgs/[id]/members/route")) as { POST: RouteHandler };
  return POST(
    jsonPost("http://test/api/orgs/org-1/members", { userId: "u2", role: "Member" }),
    withParams({ id: "org-1" }),
  );
}

async function patchOrgMember(
  memberId = "u2",
  body: Record<string, unknown> = { role: "Teacher" },
) {
  const { PATCH } = (await import("@/app/api/orgs/[id]/members/[memberId]/route")) as {
    PATCH: RouteHandler;
  };
  return PATCH(
    jsonPatch(`http://test/api/orgs/org-1/members/${memberId}`, body),
    withParams({ id: "org-1", memberId }),
  );
}

async function deleteOrgMember(memberId = "u2") {
  const { DELETE } = (await import("@/app/api/orgs/[id]/members/[memberId]/route")) as {
    DELETE: RouteHandler;
  };
  return DELETE(
    deleteReq(`http://test/api/orgs/org-1/members/${memberId}`),
    withParams({ id: "org-1", memberId }),
  );
}

// ===========================================================================
// GET /api/orgs
// ===========================================================================

test("GET /api/orgs returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await getOrgs();
  assert.equal(res.status, 401);
});

test("GET /api/orgs returns caller memberships", async () => {
  const res = await getOrgs();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { memberships: Array<{ orgId: string }> };
  assert.equal(body.memberships.length, 1);
  assert.equal(body.memberships[0].orgId, "org-1");
});

// ===========================================================================
// GET /api/orgs/[id]
// ===========================================================================

test("GET /api/orgs/[id] returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await getOrg("org-1");
  assert.equal(res.status, 401);
});

test("GET /api/orgs/[id] returns 403 when caller is not an org member", async () => {
  membershipStub = null;
  isSystemAdminStub = false;
  const res = await getOrg("org-1");
  assert.equal(res.status, 403);
});

test("GET /api/orgs/[id] returns 404 for missing organization when caller is system admin", async () => {
  isSystemAdminStub = true;
  getOrganizationResult = null;
  const res = await getOrg("missing");
  assert.equal(res.status, 404);
});

test("GET /api/orgs/[id] returns organization detail for members", async () => {
  membershipStub = { role: "Teacher" };
  const res = await getOrg("org-1");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { organization: { id: string } };
  assert.equal(body.organization.id, "org-1");
});

// ===========================================================================
// GET /api/orgs/[id]/members
// ===========================================================================

test("GET /api/orgs/[id]/members returns 403 when caller lacks member management capability", async () => {
  membershipStub = { role: "Teacher" };
  isOrgAdminStub = false;
  const res = await getOrgMembers("org-1");
  assert.equal(res.status, 403);
});

test("GET /api/orgs/[id]/members returns 404 when organization does not exist", async () => {
  isSystemAdminStub = true;
  getOrganizationResult = null;
  const res = await getOrgMembers("missing");
  assert.equal(res.status, 404);
});

test("GET /api/orgs/[id]/members returns member rows for org admins", async () => {
  membershipStub = { role: "OrgAdmin" };
  isOrgAdminStub = true;
  const res = await getOrgMembers("org-1");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { members: Array<{ userId: string }> };
  assert.equal(body.members.length, 2);
  assert.equal(body.members[0].userId, "user-1");
});

// ===========================================================================
// POST /api/orgs/[id]/members
// ===========================================================================

test("POST /api/orgs/[id]/members returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await postOrgMember();
  assert.equal(res.status, 401);
});

test("POST /api/orgs/[id]/members returns 403 when caller lacks org membership management capability", async () => {
  membershipStub = { role: "Teacher" };
  isOrgAdminStub = false;
  const res = await postOrgMember();
  assert.equal(res.status, 403);
});

test("POST /api/orgs/[id]/members returns 201 with new membership on success", async () => {
  membershipStub = { role: "OrgAdmin" };
  isOrgAdminStub = true;
  const res = await postOrgMember();
  assert.equal(res.status, 201);
  const body = (await res.json()) as { ok: boolean; membership: { id: string } };
  assert.equal(body.ok, true);
  assert.equal(body.membership.id, "mem1");
});

// ===========================================================================
// PATCH /api/orgs/[id]/members/[memberId]
// ===========================================================================

test("PATCH /api/orgs/[id]/members/[memberId] returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await patchOrgMember();
  assert.equal(res.status, 401);
});

test("PATCH /api/orgs/[id]/members/[memberId] validates role", async () => {
  membershipStub = { role: "OrgAdmin" };
  isOrgAdminStub = true;
  const res = await patchOrgMember("u2", { role: "InvalidRole" });
  assert.equal(res.status, 400);
});

test("PATCH /api/orgs/[id]/members/[memberId] returns 403 when caller lacks capability", async () => {
  membershipStub = { role: "Teacher" };
  isOrgAdminStub = false;
  const res = await patchOrgMember();
  assert.equal(res.status, 403);
});

test("PATCH /api/orgs/[id]/members/[memberId] surfaces 404 from service", async () => {
  membershipStub = { role: "OrgAdmin" };
  isOrgAdminStub = true;
  updateMemberRoleResult = { ok: false, status: 404, error: "Membership not found" };
  const res = await patchOrgMember();
  assert.equal(res.status, 404);
});

test("PATCH /api/orgs/[id]/members/[memberId] surfaces last-admin 409 guard", async () => {
  membershipStub = { role: "OrgAdmin" };
  isOrgAdminStub = true;
  updateMemberRoleResult = {
    ok: false,
    status: 409,
    error: "Cannot demote the last organization admin",
  };
  const res = await patchOrgMember();
  assert.equal(res.status, 409);
});

test("PATCH /api/orgs/[id]/members/[memberId] returns 200 on success", async () => {
  membershipStub = { role: "OrgAdmin" };
  isOrgAdminStub = true;
  updateMemberRoleResult = { ok: true, role: "Teacher" };
  const res = await patchOrgMember("u2", { role: "Teacher" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; role: string };
  assert.equal(body.ok, true);
  assert.equal(body.role, "Teacher");
  assert.deepEqual(updateMemberRoleArgs, { orgId: "org-1", memberId: "u2", role: "Teacher" });
});

// ===========================================================================
// DELETE /api/orgs/[id]/members/[memberId]
// ===========================================================================

test("DELETE /api/orgs/[id]/members/[memberId] returns 403 when caller lacks capability", async () => {
  membershipStub = { role: "Teacher" };
  isOrgAdminStub = false;
  const res = await deleteOrgMember();
  assert.equal(res.status, 403);
});

test("DELETE /api/orgs/[id]/members/[memberId] returns 404 for unknown membership", async () => {
  membershipStub = { role: "OrgAdmin" };
  isOrgAdminStub = true;
  removeMemberResult = { ok: false, status: 404, error: "Membership not found" };
  const res = await deleteOrgMember();
  assert.equal(res.status, 404);
});

test("DELETE /api/orgs/[id]/members/[memberId] returns 409 for last-admin guard", async () => {
  membershipStub = { role: "OrgAdmin" };
  isOrgAdminStub = true;
  removeMemberResult = { ok: false, status: 409, error: "Cannot remove the last organization admin" };
  const res = await deleteOrgMember();
  assert.equal(res.status, 409);
});

test("DELETE /api/orgs/[id]/members/[memberId] returns 200 on success", async () => {
  membershipStub = { role: "OrgAdmin" };
  isOrgAdminStub = true;
  removeMemberResult = { ok: true };
  const res = await deleteOrgMember("u2");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean };
  assert.equal(body.ok, true);
  assert.deepEqual(removeMemberArgs, { orgId: "org-1", memberId: "u2" });
});
