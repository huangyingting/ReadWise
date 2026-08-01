/**
 * HTTP route tests for the platform-admin organizations endpoints (#1163).
 *
 * Covers:
 *   GET  /api/admin/organizations           (list)
 *   POST /api/admin/organizations           (create + seed first OrgAdmin)
 *   GET  /api/admin/organizations/[id]       (detail)
 *   plus capability gating (401 unauth, 403 insufficient capability) on each.
 *
 * Mocks: @/lib/api-auth (capability gate via the shared fullAuthExports helper),
 * @/lib/admin/organizations (list + detail read model), @/lib/org (transactional
 * createOrganization plus a guard spy for redundant addMember calls), and
 * @/lib/prisma (owner-existence lookup) — no DB.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { type AuthState, fullAuthExports } from "./support/auth-mock";
import {
  type RouteHandler,
  getReq,
  jsonPost,
  readJson,
  withParams,
} from "./support/route";

let authState: AuthState = "ok";

let listResult: Record<string, unknown>;
let detailResult: Record<string, unknown> | null;
let ownerLookup: { id: string } | null;

let listCalls: Array<Record<string, unknown>> = [];
let detailCalls: string[] = [];
let createOrgCalls: Array<{ input: { name: string; slug?: string }; userId: string }> = [];
let addMemberCalls: Array<{ orgId: string; userId: string; role: string }> = [];
let userFindCalls: string[] = [];
let auditCalls: Array<{
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}> = [];

const COLLECTION_URL = "http://test/api/admin/organizations";
const DETAIL_URL = "http://test/api/admin/organizations/org-1";

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: fullAuthExports(() => authState),
  });

  mock.module("@/lib/admin/organizations", {
    namedExports: {
      listOrganizations: async (opts: Record<string, unknown>) => {
        listCalls.push(opts);
        return listResult;
      },
      getOrganizationDetail: async (id: string) => {
        detailCalls.push(id);
        return detailResult;
      },
    },
  });

  mock.module("@/lib/org", {
    namedExports: {
      createOrganization: async (input: { name: string; slug?: string }, userId: string) => {
        createOrgCalls.push({ input, userId });
        return {
          organization: { id: "org-created", name: input.name, slug: input.slug ?? "org-created" },
          membership: { id: "m-created", orgId: "org-created", userId, role: "OrgAdmin" },
        };
      },
      addMember: async (orgId: string, userId: string, role: string) => {
        addMemberCalls.push({ orgId, userId, role });
        return { id: "m-created", orgId, userId, role };
      },
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        user: {
          findUnique: async ({ where }: { where: { id: string } }) => {
            userFindCalls.push(where.id);
            return ownerLookup;
          },
        },
      },
    },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        securityAdminAccessDenied: "security.admin_access_denied",
        adminOrganizationCreate: "admin.organization.create",
      },
      auditRequestInfo: () => ({ ipAddress: null, userAgent: null }),
      tryRecordAuditLog: async () => {},
      recordAuditFromRequest: async (input: {
        action: string;
        targetType: string;
        targetId?: string | null;
        metadata?: Record<string, unknown> | null;
      }) => {
        auditCalls.push(input);
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  listResult = {
    organizations: [
      { id: "org-1", name: "ReadWise", slug: "readwise", createdAt: new Date("2026-07-01T00:00:00.000Z"), memberCount: 3, classroomCount: 1 },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    query: "",
    sort: "createdAt",
    order: "desc",
  };
  detailResult = {
    id: "org-1",
    name: "ReadWise",
    slug: "readwise",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    memberCount: 3,
    classroomCount: 1,
    members: [],
    classrooms: [],
  };
  ownerLookup = { id: "user-9" };

  listCalls = [];
  detailCalls = [];
  createOrgCalls = [];
  addMemberCalls = [];
  userFindCalls = [];
  auditCalls = [];
});

async function getList(url = COLLECTION_URL) {
  const { GET } = (await import("@/app/api/admin/organizations/route")) as { GET: RouteHandler };
  return GET(getReq(url));
}

async function postCreate(body: unknown) {
  const { POST } = (await import("@/app/api/admin/organizations/route")) as { POST: RouteHandler };
  return POST(jsonPost(COLLECTION_URL, body));
}

async function getDetail(id = "org-1") {
  const { GET } = (await import("@/app/api/admin/organizations/[id]/route")) as { GET: RouteHandler };
  return GET(getReq(`http://test/api/admin/organizations/${id}`), withParams({ id }));
}

// ===========================================================================
// GET /api/admin/organizations
// ===========================================================================

test("GET list returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await getList();
  assert.equal(res.status, 401);
});

test("GET list returns 403 when the session lacks organizations.manage", async () => {
  authState = "forbidden";
  const res = await getList();
  assert.equal(res.status, 403);
});

test("GET list returns the platform-wide organizations page", async () => {
  const res = await getList();
  assert.equal(res.status, 200);
  const body = await readJson<{ organizations: Array<{ id: string }>; total: number }>(res);
  assert.equal(body.total, 1);
  assert.equal(body.organizations[0]?.id, "org-1");
});

test("GET list forwards search/pagination/sort params to the read model", async () => {
  const res = await getList(`${COLLECTION_URL}?q=read&page=2&sort=members&order=asc`);
  assert.equal(res.status, 200);
  assert.deepEqual(listCalls[0], { q: "read", page: 2, sort: "members", order: "asc" });
});

// ===========================================================================
// POST /api/admin/organizations
// ===========================================================================

test("POST create returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await postCreate({ name: "Acme", ownerUserId: "user-9" });
  assert.equal(res.status, 401);
});

test("POST create returns 403 when the session lacks organizations.manage", async () => {
  authState = "forbidden";
  const res = await postCreate({ name: "Acme", ownerUserId: "user-9" });
  assert.equal(res.status, 403);
  assert.equal(createOrgCalls.length, 0);
});

test("POST create validates the body (name + ownerUserId required)", async () => {
  const missingName = await postCreate({ ownerUserId: "user-9" });
  assert.equal(missingName.status, 400);

  const missingOwner = await postCreate({ name: "Acme" });
  assert.equal(missingOwner.status, 400);

  assert.equal(createOrgCalls.length, 0);
});

test("POST create returns 404 when the owner user does not exist", async () => {
  ownerLookup = null;
  const res = await postCreate({ name: "Acme", ownerUserId: "ghost" });
  assert.equal(res.status, 404);
  assert.deepEqual(userFindCalls, ["ghost"]);
  assert.equal(createOrgCalls.length, 0);
});

test("POST create seeds the owner as the first OrgAdmin and returns 201", async () => {
  const res = await postCreate({ name: "Acme", slug: "acme", ownerUserId: "user-9" });
  assert.equal(res.status, 201);
  const body = await readJson<{ ok: boolean; organization: { id: string }; membership: { role: string } }>(res);
  assert.equal(body.ok, true);
  assert.equal(body.organization.id, "org-created");
  assert.equal(body.membership.role, "OrgAdmin");
  assert.deepEqual(createOrgCalls[0], { input: { name: "Acme", slug: "acme" }, userId: "user-9" });
  assert.equal(
    addMemberCalls.length,
    0,
    "createOrganization already creates the first OrgAdmin membership",
  );
  assert.equal(auditCalls.at(-1)?.action, "admin.organization.create");
  assert.equal(auditCalls.at(-1)?.targetType, "organization");
  assert.equal(auditCalls.at(-1)?.targetId, "org-created");
  assert.deepEqual(auditCalls.at(-1)?.metadata, { ownerUserId: "user-9", slug: "acme" });
});

// ===========================================================================
// GET /api/admin/organizations/[id]
// ===========================================================================

test("GET detail returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await getDetail();
  assert.equal(res.status, 401);
});

test("GET detail returns 403 when the session lacks organizations.manage", async () => {
  authState = "forbidden";
  const res = await getDetail();
  assert.equal(res.status, 403);
});

test("GET detail returns 404 for a missing organization", async () => {
  detailResult = null;
  const res = await getDetail("missing");
  assert.equal(res.status, 404);
  assert.deepEqual(detailCalls, ["missing"]);
});

test("GET detail returns the organization detail for an authorized admin", async () => {
  const res = await getDetail("org-1");
  assert.equal(res.status, 200);
  const body = await readJson<{ organization: { id: string; slug: string } }>(res);
  assert.equal(body.organization.id, "org-1");
  assert.equal(body.organization.slug, "readwise");
});
