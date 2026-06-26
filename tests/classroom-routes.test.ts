/**
 * HTTP route tests for classroom / assignment / analytics endpoints (RW-061).
 * TEST2-1, TEST2-2, TEST2-5
 *
 * Covers:
 *   POST /api/classrooms                       — 401, 403, 201
 *   GET  /api/classrooms/[id]/analytics        — 401, 404, RBAC matrix (teacher/orgAdmin/learner)
 *   POST /api/classrooms/[id]/members          — 401, 404, 403, 201
 *   POST /api/classrooms/[id]/assignments      — 401, 403, 404, 400 (invalid due date), 201
 *   POST /api/assignments/[id]/completion      — 401, 404, 201
 *
 * Mocks: @/lib/api-auth, @/lib/classroom, @/lib/org, @/lib/analytics/tenant,
 *        @/lib/prisma — no DB or real auth. @/lib/tenant-api is NOT mocked;
 *        the real functions run against mocked @/lib/org + @/lib/classroom
 *        dependencies so the real ApiError throws are exercised.
 *
 * NOTE: Do NOT import anything from @/lib/api-handler at the top level —
 * doing so eagerly loads @/lib/api-auth (via its static import chain) before
 * the mock.module() call in before() can intercept it, causing a 500 on every
 * request.
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
let currentSession: { user: { id: string; role: string; name: string; email: string | null } } =
  readerSession;

// Classroom stubs (also controls tenant-api behavior via real requireClassroomManageApi)
// Set teacherId to "user-1" (readerSession.user.id) to allow access,
// or to "other-teacher" to trigger 403 from canManageClassroom.
let classroomStub: { id: string; orgId: string; teacherId: string } | null = {
  id: "c1",
  orgId: "org-1",
  teacherId: "teacher-1",
};
let createClassroomResult: Record<string, unknown> = {
  id: "c1",
  name: "Class 1",
  orgId: "org-1",
};
let addMemberResult: Record<string, unknown> = {
  id: "mem1",
  userId: "u2",
  classroomId: "c1",
  role: "Student",
};
let assignArticleResult: Record<string, unknown> = {
  id: "asgn1",
  classroomId: "c1",
  articleId: "a1",
  dueDate: null,
};
let completionResult: Record<string, unknown> = {
  id: "comp1",
  userId: "user-1",
  assignmentId: "asgn1",
  status: "COMPLETED",
};
let assignmentContext: { id: string } | null = { id: "asgn1" };

// org stubs — controls requireOrgCapabilityApi (for POST /classrooms) and
// the inline RBAC check in GET /classrooms/[id]/analytics.
// isOrgAdminStub = true → hasOrgCapability() returns true in both paths.
let membershipStub: { role: string } | null = null;
let isOrgAdminStub = false;

// analytics stubs
let analyticsViewerRoleStub: string = "teacher";
let analyticsDataStub: Record<string, unknown> | null = {
  classroomId: "c1",
  completionRate: 0.75,
  members: [{ userId: "u2", completions: 1 }],
};

// prisma stubs — assignments route reads articles
let articleStub: { id: string } | null = { id: "a1" };

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
        return { session: currentSession };
      },
    },
  });

  // @/lib/classroom — used directly by routes AND by the real @/lib/tenant-api
  mock.module("@/lib/classroom", {
    namedExports: {
      // canManageClassroom is imported by @/lib/tenant-api; provide a simplified
      // version that mirrors the real guard (viewer.id === classroom.teacherId).
      canManageClassroom: (
        viewer: { id?: string | null } | null,
        classroom: { teacherId?: string } | null | undefined,
        _membership: unknown,
      ) => {
        if (!classroom) return false;
        return viewer?.id === classroom.teacherId || isOrgAdminStub;
      },
      getClassroom: async () => classroomStub,
      createClassroom: async () => createClassroomResult,
      addClassroomMember: async () => addMemberResult,
      assignArticle: async () => assignArticleResult,
      getStudentAssignmentContext: async () => assignmentContext,
      recordAssignmentCompletion: async () => completionResult,
    },
  });

  // @/lib/org — used directly by the analytics route AND by real @/lib/tenant-api
  mock.module("@/lib/org", {
    namedExports: {
      getMembership: async () => membershipStub,
      // hasOrgCapability controls both requireOrgCapabilityApi (POST /classrooms) and
      // the inline isOrgAdmin check in the analytics route.
      hasOrgCapability: () => isOrgAdminStub,
      isSystemAdmin: () => false,
      // re-export canManageClassroom alias that tenant-api doesn't use via org barrel
    },
  });

  mock.module("@/lib/analytics/tenant", {
    namedExports: {
      viewerRoleForClassroom: () => analyticsViewerRoleStub,
      getClassroomAnalytics: async () => analyticsDataStub,
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findUnique: async () => articleStub,
          findFirst: async () => articleStub,
        },
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  currentSession = readerSession;
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  createClassroomResult = { id: "c1", name: "Class 1", orgId: "org-1" };
  addMemberResult = { id: "mem1", userId: "u2", classroomId: "c1", role: "Student" };
  assignArticleResult = { id: "asgn1", classroomId: "c1", articleId: "a1", dueDate: null };
  completionResult = { id: "comp1", userId: "user-1", assignmentId: "asgn1", status: "COMPLETED" };
  assignmentContext = { id: "asgn1" };
  membershipStub = null;
  isOrgAdminStub = false;
  analyticsViewerRoleStub = "teacher";
  analyticsDataStub = { classroomId: "c1", completionRate: 0.75, members: [] };
  articleStub = { id: "a1" };
});

// ===========================================================================
// POST /api/classrooms
// ===========================================================================

test("POST /api/classrooms returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/classrooms/route")) as { POST: RouteHandler };
  const res = await POST(jsonPost("http://test/api/classrooms", { orgId: "org-1", name: "Class A" }));
  assert.equal(res.status, 401);
});

test("POST /api/classrooms returns 403 when caller lacks org capability", async () => {
  // membershipStub = null + isOrgAdminStub = false → real requireOrgCapabilityApi throws 403
  membershipStub = null;
  isOrgAdminStub = false;
  const { POST } = (await import("@/app/api/classrooms/route")) as { POST: RouteHandler };
  const res = await POST(jsonPost("http://test/api/classrooms", { orgId: "org-1", name: "Class A" }));
  assert.equal(res.status, 403);
  const body = await res.json() as { error: string };
  assert.ok(typeof body.error === "string");
});

test("POST /api/classrooms returns 201 with the new classroom on success", async () => {
  // isOrgAdminStub = true → real requireOrgCapabilityApi passes
  isOrgAdminStub = true;
  const { POST } = (await import("@/app/api/classrooms/route")) as { POST: RouteHandler };
  const res = await POST(jsonPost("http://test/api/classrooms", { orgId: "org-1", name: "Class A" }));
  assert.equal(res.status, 201);
  const body = await res.json() as { classroom: { id: string } };
  assert.equal(body.classroom.id, "c1");
});

// ===========================================================================
// GET /api/classrooms/[id]/analytics  — RBAC matrix
// ===========================================================================

test("GET /api/classrooms/[id]/analytics returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/classrooms/[id]/analytics/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/classrooms/c1/analytics"), withParams({ id: "c1" }));
  assert.equal(res.status, 401);
});

test("GET /api/classrooms/[id]/analytics returns 404 when classroom not found", async () => {
  classroomStub = null;
  const { GET } = (await import("@/app/api/classrooms/[id]/analytics/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/classrooms/missing/analytics"), withParams({ id: "missing" }));
  assert.equal(res.status, 404);
});

test("GET /api/classrooms/[id]/analytics returns 403 for a learner (not teacher, not orgAdmin)", async () => {
  // learner: different user, not the teacher, orgAdmin=false, not system admin
  currentSession = { user: { id: "learner-1", role: "Reader", name: "L", email: "l@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  isOrgAdminStub = false;
  const { GET } = (await import("@/app/api/classrooms/[id]/analytics/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/classrooms/c1/analytics"), withParams({ id: "c1" }));
  assert.equal(res.status, 403);
});

test("GET /api/classrooms/[id]/analytics returns full detail for the classroom teacher", async () => {
  // teacher: session.user.id === classroom.teacherId
  currentSession = { user: { id: "teacher-1", role: "Reader", name: "T", email: "t@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  isOrgAdminStub = false;
  analyticsViewerRoleStub = "teacher";
  analyticsDataStub = { classroomId: "c1", completionRate: 0.8, members: [{ userId: "u2", completions: 2 }] };
  const { GET } = (await import("@/app/api/classrooms/[id]/analytics/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/classrooms/c1/analytics"), withParams({ id: "c1" }));
  assert.equal(res.status, 200);
  const body = await res.json() as { role: string; analytics: Record<string, unknown> };
  assert.equal(body.role, "teacher");
  assert.ok(body.analytics, "analytics payload present");
});

test("GET /api/classrooms/[id]/analytics returns aggregate data for an org admin", async () => {
  // orgAdmin: not the teacher, but hasOrgCapability=true
  currentSession = { user: { id: "orgadmin-1", role: "Reader", name: "A", email: "a@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  isOrgAdminStub = true;
  analyticsViewerRoleStub = "orgAdmin";
  // aggregate stub — individual rows redacted (simulating what the real fn returns)
  analyticsDataStub = { classroomId: "c1", completionRate: 0.7, members: [] };
  const { GET } = (await import("@/app/api/classrooms/[id]/analytics/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://test/api/classrooms/c1/analytics"), withParams({ id: "c1" }));
  assert.equal(res.status, 200);
  const body = await res.json() as { role: string; analytics: Record<string, unknown> };
  assert.equal(body.role, "orgAdmin");
  assert.ok(body.analytics, "analytics payload present");
  // Individual member rows are absent in the aggregate view
  assert.deepEqual((body.analytics as { members: unknown[] }).members, []);
});

// ===========================================================================
// POST /api/classrooms/[id]/members
// ===========================================================================

test("POST /api/classrooms/[id]/members returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/classrooms/[id]/members/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/classrooms/c1/members", { userId: "u2", role: "Student" }),
    withParams({ id: "c1" }),
  );
  assert.equal(res.status, 401);
});

test("POST /api/classrooms/[id]/members returns 404 when classroom not found", async () => {
  classroomStub = null;
  const { POST } = (await import("@/app/api/classrooms/[id]/members/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/classrooms/missing/members", { userId: "u2", role: "Student" }),
    withParams({ id: "missing" }),
  );
  assert.equal(res.status, 404);
});

test("POST /api/classrooms/[id]/members returns 403 when caller cannot manage classroom", async () => {
  // teacherId !== user-1 (readerSession), membership is null → canManageClassroom = false → 403
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  const { POST } = (await import("@/app/api/classrooms/[id]/members/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/classrooms/c1/members", { userId: "u2", role: "Student" }),
    withParams({ id: "c1" }),
  );
  assert.equal(res.status, 403);
});

test("POST /api/classrooms/[id]/members returns 201 and new member on success", async () => {
  // teacherId === user-1 (readerSession) → canManageClassroom = true
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const { POST } = (await import("@/app/api/classrooms/[id]/members/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/classrooms/c1/members", { userId: "u2", role: "Student" }),
    withParams({ id: "c1" }),
  );
  assert.equal(res.status, 201);
  const body = await res.json() as { ok: boolean; member: { id: string } };
  assert.equal(body.ok, true);
  assert.equal(body.member.id, "mem1");
});

// ===========================================================================
// POST /api/classrooms/[id]/assignments
// ===========================================================================

test("POST /api/classrooms/[id]/assignments returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/classrooms/[id]/assignments/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/classrooms/c1/assignments", { articleId: "a1" }),
    withParams({ id: "c1" }),
  );
  assert.equal(res.status, 401);
});

test("POST /api/classrooms/[id]/assignments returns 403 when caller cannot manage classroom", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  const { POST } = (await import("@/app/api/classrooms/[id]/assignments/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/classrooms/c1/assignments", { articleId: "a1" }),
    withParams({ id: "c1" }),
  );
  assert.equal(res.status, 403);
});

test("POST /api/classrooms/[id]/assignments returns 404 when article not found", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  articleStub = null;
  const { POST } = (await import("@/app/api/classrooms/[id]/assignments/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/classrooms/c1/assignments", { articleId: "missing-article" }),
    withParams({ id: "c1" }),
  );
  assert.equal(res.status, 404);
  const body = await res.json() as { error: string };
  assert.match(body.error, /article/i);
});

test("POST /api/classrooms/[id]/assignments returns 400 for an invalid due date", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const { POST } = (await import("@/app/api/classrooms/[id]/assignments/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/classrooms/c1/assignments", { articleId: "a1", dueDate: "not-a-date" }),
    withParams({ id: "c1" }),
  );
  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.match(body.error, /due date/i);
});

test("POST /api/classrooms/[id]/assignments returns 201 with assignment on success", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const { POST } = (await import("@/app/api/classrooms/[id]/assignments/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/classrooms/c1/assignments", {
      articleId: "a1",
      dueDate: "2026-12-31",
      instructions: "Read carefully",
    }),
    withParams({ id: "c1" }),
  );
  assert.equal(res.status, 201);
  const body = await res.json() as { assignment: { id: string } };
  assert.equal(body.assignment.id, "asgn1");
});

// ===========================================================================
// POST /api/assignments/[id]/completion
// ===========================================================================

test("POST /api/assignments/[id]/completion returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const { POST } = (await import("@/app/api/assignments/[id]/completion/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/assignments/asgn1/completion", { status: "COMPLETED" }),
    withParams({ id: "asgn1" }),
  );
  assert.equal(res.status, 401);
});

test("POST /api/assignments/[id]/completion returns 404 when student is not in the classroom", async () => {
  assignmentContext = null;
  const { POST } = (await import("@/app/api/assignments/[id]/completion/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/assignments/asgn-x/completion", { status: "COMPLETED" }),
    withParams({ id: "asgn-x" }),
  );
  assert.equal(res.status, 404);
});

test("POST /api/assignments/[id]/completion returns 201 with completion record on success", async () => {
  const { POST } = (await import("@/app/api/assignments/[id]/completion/route")) as { POST: RouteHandler };
  const res = await POST(
    jsonPost("http://test/api/assignments/asgn1/completion", { status: "COMPLETED", quizScore: 90 }),
    withParams({ id: "asgn1" }),
  );
  assert.equal(res.status, 201);
  const body = await res.json() as { ok: boolean; completion: { id: string } };
  assert.equal(body.ok, true);
  assert.equal(body.completion.id, "comp1");
});
