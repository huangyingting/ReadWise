/**
 * HTTP route tests for classroom / assignment / analytics endpoints (RW-061).
 * TEST2-1, TEST2-2, TEST2-5
 *
 * Covers:
 *   GET  /api/classrooms                       — 401, 200
 *   POST /api/classrooms                       — 401, 403, 201
 *   GET  /api/classrooms/[id]                  — 401, 404, 403, 200
 *   GET  /api/classrooms/[id]/analytics        — 401, 404, RBAC matrix (teacher/orgAdmin/learner)
 *   POST /api/classrooms/[id]/members          — 401, 404, 403, 201
 *   DELETE /api/classrooms/[id]/members/[userId] — 401, 400, 404, 403, 200
 *   POST /api/classrooms/[id]/assignments      — 401, 403, 404, 400 (invalid due date), 201
 *   DELETE /api/assignments/[id]               — 401, 404, 403, 200
 *   POST /api/assignments/[id]/completion      — 401, 404, 201
 *
 * Mocks: @/lib/api-auth, @/lib/classroom, @/lib/org, org/classroom submodules
 *        consumed by @/lib/tenant-api and @/lib/analytics/classroom-access,
 *        @/lib/analytics/tenant, @/lib/prisma — no DB or real auth.
 *        @/lib/tenant-api is NOT mocked; the real functions run against the
 *        mocked org/classroom dependencies so real ApiError throws are exercised.
 *
 * NOTE: Do NOT import anything from @/lib/api-handler at the top level —
 * doing so eagerly loads @/lib/api-auth (via its static import chain) before
 * the mock.module() call in before() can intercept it, causing a 500 on every
 * request.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, readerSession, withParams, getReq, jsonPost, jsonPatch, deleteReq } from "./support/route";

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
let classroomListResult: Array<Record<string, unknown>> = [
  { id: "c1", orgId: "org-1", teacherId: "teacher-1", name: "Class 1" },
];
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
let assignmentClassroomResult: { id: string; classroomId: string } | null = {
  id: "asgn1",
  classroomId: "c1",
};
let articleAssignmentFailure: {
  status: 400 | 404 | 409;
  reason: "invalid_due_date" | "article_not_found" | "org_reference_orphaned";
} | null = null;
const removeClassroomMemberCalls: Array<{ classroomId: string; userId: string }> = [];
const deleteAssignmentCalls: string[] = [];
const updateAssignmentCalls: Array<{
  assignmentId: string;
  input: { dueDate?: string; instructions?: string | null };
}> = [];
let updateAssignmentResult:
  | { ok: true; assignment: Record<string, unknown> }
  | { ok: false; status: 400; reason: "invalid_due_date" } = {
  ok: true,
  assignment: { id: "asgn1", classroomId: "c1", dueDate: null, instructions: null },
};

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

  // @/lib/classroom — used directly by routes.
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
      listClassroomsForTeacher: async () => classroomListResult,
      createClassroom: async () => createClassroomResult,
      addClassroomMember: async () => addMemberResult,
      removeClassroomMember: async (classroomId: string, userId: string) => {
        removeClassroomMemberCalls.push({ classroomId, userId });
      },
      getAssignmentClassroom: async () => assignmentClassroomResult,
      deleteAssignment: async (assignmentId: string) => {
        deleteAssignmentCalls.push(assignmentId);
      },
      updateAssignment: async (
        assignmentId: string,
        input: { dueDate?: string; instructions?: string | null },
      ) => {
        updateAssignmentCalls.push({ assignmentId, input });
        return updateAssignmentResult;
      },
      getStudentAssignmentContext: async () => assignmentContext,
      recordAssignmentCompletion: async () => completionResult,
    },
  });
  // tenant-api + classroom-access import classroom submodules directly.
  mock.module("@/lib/classroom/guards", {
    namedExports: {
      canManageClassroom: (
        viewer: { id?: string | null } | null,
        classroom: { teacherId?: string } | null | undefined,
      ) => {
        if (!classroom) return false;
        return viewer?.id === classroom.teacherId || isOrgAdminStub;
      },
    },
  });
  mock.module("@/lib/classroom/queries", {
    namedExports: {
      getClassroom: async () => classroomStub,
    },
  });
  mock.module("@/lib/classroom/article-assignments", {
    namedExports: {
      createArticleAssignment: async (input: { dueDate?: string }) => {
        if (articleAssignmentFailure) {
          return { ok: false, ...articleAssignmentFailure };
        }
        if (!articleStub) {
          return { ok: false, status: 404, reason: "article_not_found" };
        }
        if (input.dueDate && Number.isNaN(new Date(input.dueDate).getTime())) {
          return { ok: false, status: 400, reason: "invalid_due_date" };
        }
        return { ok: true, assignment: assignArticleResult };
      },
    },
  });

  // @/lib/org — kept for route modules that still consume the barrel directly.
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
  mock.module("@/lib/org/queries", {
    namedExports: {
      getMembership: async () => membershipStub,
    },
  });
  mock.module("@/lib/org/guards", {
    namedExports: {
      hasOrgCapability: () => isOrgAdminStub,
      isSystemAdmin: () => false,
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
  classroomListResult = [{ id: "c1", orgId: "org-1", teacherId: "teacher-1", name: "Class 1" }];
  addMemberResult = { id: "mem1", userId: "u2", classroomId: "c1", role: "Student" };
  assignArticleResult = { id: "asgn1", classroomId: "c1", articleId: "a1", dueDate: null };
  completionResult = { id: "comp1", userId: "user-1", assignmentId: "asgn1", status: "COMPLETED" };
  assignmentContext = { id: "asgn1" };
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1" };
  articleAssignmentFailure = null;
  membershipStub = null;
  isOrgAdminStub = false;
  analyticsViewerRoleStub = "teacher";
  analyticsDataStub = { classroomId: "c1", completionRate: 0.75, members: [] };
  articleStub = { id: "a1" };
  removeClassroomMemberCalls.length = 0;
  deleteAssignmentCalls.length = 0;
  updateAssignmentCalls.length = 0;
  updateAssignmentResult = {
    ok: true,
    assignment: { id: "asgn1", classroomId: "c1", dueDate: null, instructions: null },
  };
});

async function postClassrooms(body: Record<string, unknown>) {
  const { POST } = (await import("@/app/api/classrooms/route")) as { POST: RouteHandler };
  return POST(jsonPost("http://test/api/classrooms", body));
}

async function getClassrooms() {
  const { GET } = (await import("@/app/api/classrooms/route")) as { GET: RouteHandler };
  return GET(getReq("http://test/api/classrooms"));
}

async function getClassroom(id = "c1") {
  const { GET } = (await import("@/app/api/classrooms/[id]/route")) as { GET: RouteHandler };
  return GET(getReq(`http://test/api/classrooms/${id}`), withParams({ id }));
}

async function getClassroomAnalytics(id = "c1") {
  const { GET } = (await import("@/app/api/classrooms/[id]/analytics/route")) as {
    GET: RouteHandler;
  };
  return GET(new Request(`http://test/api/classrooms/${id}/analytics`), withParams({ id }));
}

async function getClassroomAnalyticsExport(id = "c1", query = "?format=json") {
  const { GET } = (await import("@/app/api/classrooms/[id]/analytics/export/route")) as {
    GET: RouteHandler;
  };
  return GET(
    new Request(`http://test/api/classrooms/${id}/analytics/export${query}`),
    withParams({ id }),
  );
}

async function postClassroomMember(id: string, body: Record<string, unknown>) {
  const { POST } = (await import("@/app/api/classrooms/[id]/members/route")) as {
    POST: RouteHandler;
  };
  return POST(jsonPost(`http://test/api/classrooms/${id}/members`, body), withParams({ id }));
}

async function deleteClassroomMember(id: string, userId: string) {
  const { DELETE } = (await import("@/app/api/classrooms/[id]/members/[userid]/route")) as {
    DELETE: RouteHandler;
  };
  return DELETE(
    deleteReq(`http://test/api/classrooms/${id}/members/${userId}`),
    withParams({ id, userid: userId }),
  );
}

async function postClassroomAssignment(id: string, body: Record<string, unknown>) {
  const { POST } = (await import("@/app/api/classrooms/[id]/assignments/route")) as {
    POST: RouteHandler;
  };
  return POST(jsonPost(`http://test/api/classrooms/${id}/assignments`, body), withParams({ id }));
}

async function postAssignmentCompletion(id: string, body: Record<string, unknown>) {
  const { POST } = (await import("@/app/api/assignments/[id]/completion/route")) as {
    POST: RouteHandler;
  };
  return POST(jsonPost(`http://test/api/assignments/${id}/completion`, body), withParams({ id }));
}

async function deleteAssignmentRoute(id: string) {
  const { DELETE } = (await import("@/app/api/assignments/[id]/route")) as {
    DELETE: RouteHandler;
  };
  return DELETE(deleteReq(`http://test/api/assignments/${id}`), withParams({ id }));
}

async function patchAssignmentRoute(id: string, body: Record<string, unknown>) {
  const { PATCH } = (await import("@/app/api/assignments/[id]/route")) as {
    PATCH: RouteHandler;
  };
  return PATCH(jsonPatch(`http://test/api/assignments/${id}`, body), withParams({ id }));
}

// ===========================================================================
// GET /api/classrooms
// ===========================================================================

test("GET /api/classrooms returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await getClassrooms();
  assert.equal(res.status, 401);
});

test("GET /api/classrooms returns teacher-managed classrooms", async () => {
  classroomListResult = [
    { id: "c1", orgId: "org-1", teacherId: "teacher-1", name: "Class 1" },
    { id: "c2", orgId: "org-1", teacherId: "teacher-1", name: "Class 2" },
  ];
  const res = await getClassrooms();
  assert.equal(res.status, 200);
  const body = await res.json() as { classrooms: Array<{ id: string }> };
  assert.equal(body.classrooms.length, 2);
  assert.equal(body.classrooms[0].id, "c1");
});

// ===========================================================================
// POST /api/classrooms
// ===========================================================================

test("POST /api/classrooms returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await postClassrooms({ orgId: "org-1", name: "Class A" });
  assert.equal(res.status, 401);
});

test("POST /api/classrooms returns 403 when caller lacks org capability", async () => {
  // membershipStub = null + isOrgAdminStub = false → real requireOrgCapabilityApi throws 403
  membershipStub = null;
  isOrgAdminStub = false;
  const res = await postClassrooms({ orgId: "org-1", name: "Class A" });
  assert.equal(res.status, 403);
  const body = await res.json() as { error: string };
  assert.ok(typeof body.error === "string");
});

test("POST /api/classrooms returns 201 with the new classroom on success", async () => {
  // isOrgAdminStub = true → real requireOrgCapabilityApi passes
  isOrgAdminStub = true;
  const res = await postClassrooms({ orgId: "org-1", name: "Class A" });
  assert.equal(res.status, 201);
  const body = await res.json() as { classroom: { id: string } };
  assert.equal(body.classroom.id, "c1");
});

// ===========================================================================
// GET /api/classrooms/[id]
// ===========================================================================

test("GET /api/classrooms/[id] returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await getClassroom("c1");
  assert.equal(res.status, 401);
});

test("GET /api/classrooms/[id] returns 404 when classroom not found", async () => {
  classroomStub = null;
  const res = await getClassroom("missing");
  assert.equal(res.status, 404);
});

test("GET /api/classrooms/[id] returns 403 when caller cannot manage classroom", async () => {
  currentSession = { user: { id: "teacher-1", role: "Reader", name: "T", email: "t@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  isOrgAdminStub = false;
  const res = await getClassroom("c1");
  assert.equal(res.status, 403);
});

test("GET /api/classrooms/[id] returns classroom detail on success", async () => {
  currentSession = { user: { id: "teacher-1", role: "Reader", name: "T", email: "t@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  const res = await getClassroom("c1");
  assert.equal(res.status, 200);
  const body = await res.json() as { classroom: { id: string } };
  assert.equal(body.classroom.id, "c1");
});

// ===========================================================================
// GET /api/classrooms/[id]/analytics  — RBAC matrix
// ===========================================================================

test("GET /api/classrooms/[id]/analytics returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await getClassroomAnalytics();
  assert.equal(res.status, 401);
});

test("GET /api/classrooms/[id]/analytics returns 404 when classroom not found", async () => {
  classroomStub = null;
  const res = await getClassroomAnalytics("missing");
  assert.equal(res.status, 404);
});

test("GET /api/classrooms/[id]/analytics returns 403 for a learner (not teacher, not orgAdmin)", async () => {
  // learner: different user, not the teacher, orgAdmin=false, not system admin
  currentSession = { user: { id: "learner-1", role: "Reader", name: "L", email: "l@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  isOrgAdminStub = false;
  const res = await getClassroomAnalytics();
  assert.equal(res.status, 403);
});

test("GET /api/classrooms/[id]/analytics returns full detail for the classroom teacher", async () => {
  // teacher: session.user.id === classroom.teacherId
  currentSession = { user: { id: "teacher-1", role: "Reader", name: "T", email: "t@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  isOrgAdminStub = false;
  analyticsViewerRoleStub = "teacher";
  analyticsDataStub = { classroomId: "c1", completionRate: 0.8, members: [{ userId: "u2", completions: 2 }] };
  const res = await getClassroomAnalytics();
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
  const res = await getClassroomAnalytics();
  assert.equal(res.status, 200);
  const body = await res.json() as { role: string; analytics: Record<string, unknown> };
  assert.equal(body.role, "orgAdmin");
  assert.ok(body.analytics, "analytics payload present");
  // Individual member rows are absent in the aggregate view
  assert.deepEqual((body.analytics as { members: unknown[] }).members, []);
});

test("GET /api/classrooms/[id]/analytics/export returns teacher-scoped JSON", async () => {
  currentSession = { user: { id: "teacher-1", role: "Reader", name: "T", email: "t@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  analyticsViewerRoleStub = "teacher";
  analyticsDataStub = {
    classroomId: "c1",
    classroomName: "Class 1",
    studentCount: 1,
    assignmentCount: 1,
    totalExpected: 1,
    totalCompleted: 1,
    completionRate: 100,
    averageQuizScore: 90,
    perAssignment: [{ assignmentId: "a1", articleTitle: "Article 1", assigned: 1, completed: 1, inProgress: 0, notStarted: 0, completionRate: 100, averageQuizScore: 90 }],
    perStudent: [{ studentId: "s1", name: "Sam", email: "s@example.com", completed: 1, total: 1, completionRate: 100, averageQuizScore: 90 }],
    drilldown: { filters: { assignmentId: "a1" }, rows: [{ assignmentId: "a1", articleTitle: "Article 1", studentId: "s1", name: "Sam", email: "s@example.com", status: "COMPLETED", quizScore: 90, dueDate: null, completedAt: null }] },
    redacted: false,
  };

  const res = await getClassroomAnalyticsExport("c1", "?format=json&assignmentId=a1");
  assert.equal(res.status, 200);
  const body = await res.json() as { role: string; analytics: { drilldown: { rows: unknown[] } } };
  assert.equal(body.role, "teacher");
  assert.equal(body.analytics.drilldown.rows.length, 1);
});

test("GET /api/classrooms/[id]/analytics/export preserves org-admin redaction in CSV", async () => {
  currentSession = { user: { id: "orgadmin-1", role: "Reader", name: "A", email: "a@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  isOrgAdminStub = true;
  analyticsViewerRoleStub = "orgAdmin";
  analyticsDataStub = {
    classroomId: "c1",
    classroomName: "Class 1",
    studentCount: 1,
    assignmentCount: 1,
    totalExpected: 1,
    totalCompleted: 1,
    completionRate: 100,
    averageQuizScore: 90,
    perAssignment: [{ assignmentId: "a1", articleTitle: "Article 1", assigned: 1, completed: 1, inProgress: 0, notStarted: 0, completionRate: 100, averageQuizScore: 90 }],
    perStudent: [],
    drilldown: null,
    redacted: true,
  };

  const res = await getClassroomAnalyticsExport("c1", "?format=csv&assignmentId=a1");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
  const text = await res.text();
  assert.match(text, /assignment/);
  assert.doesNotMatch(text, /Sam|s@example/);
});

test("GET /api/classrooms/[id]/analytics/export includes teacher drilldown CSV rows", async () => {
  currentSession = { user: { id: "teacher-1", role: "Reader", name: "T", email: "t@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  analyticsViewerRoleStub = "teacher";
  analyticsDataStub = {
    classroomId: "c1",
    classroomName: "Class 1",
    studentCount: 1,
    assignmentCount: 1,
    totalExpected: 1,
    totalCompleted: 1,
    completionRate: 100,
    averageQuizScore: 90,
    perAssignment: [{ assignmentId: "a1", articleTitle: "Article 1", assigned: 1, completed: 1, inProgress: 0, notStarted: 0, completionRate: 100, averageQuizScore: 90 }],
    perStudent: [{ studentId: "s1", name: "Sam", email: "s@example.com", completed: 1, total: 1, completionRate: 100, averageQuizScore: 90 }],
    drilldown: {
      filters: { assignmentId: "a1", studentId: "s1" },
      rows: [{
        assignmentId: "a1",
        articleTitle: "Article 1",
        studentId: "s1",
        name: "Sam",
        email: "s@example.com",
        status: "COMPLETED",
        quizScore: 90,
        dueDate: new Date("2026-07-10T00:00:00Z"),
        completedAt: new Date("2026-07-09T00:00:00Z"),
      }],
    },
    redacted: false,
  };

  const res = await getClassroomAnalyticsExport("c1", "?format=csv&assignmentId=a1&studentId=s1");
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /student/);
  assert.match(text, /drilldown/);
  assert.match(text, /2026-07-10T00:00:00.000Z/);
});

// ===========================================================================
// POST /api/classrooms/[id]/members
// ===========================================================================

test("POST /api/classrooms/[id]/members returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await postClassroomMember("c1", { userId: "u2", role: "Student" });
  assert.equal(res.status, 401);
});

test("POST /api/classrooms/[id]/members returns 404 when classroom not found", async () => {
  classroomStub = null;
  const res = await postClassroomMember("missing", { userId: "u2", role: "Student" });
  assert.equal(res.status, 404);
});

test("POST /api/classrooms/[id]/members returns 403 when caller cannot manage classroom", async () => {
  // teacherId !== user-1 (readerSession), membership is null → canManageClassroom = false → 403
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  const res = await postClassroomMember("c1", { userId: "u2", role: "Student" });
  assert.equal(res.status, 403);
});

test("POST /api/classrooms/[id]/members returns 201 and new member on success", async () => {
  // teacherId === user-1 (readerSession) → canManageClassroom = true
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const res = await postClassroomMember("c1", { userId: "u2", role: "Student" });
  assert.equal(res.status, 201);
  const body = await res.json() as { ok: boolean; member: { id: string } };
  assert.equal(body.ok, true);
  assert.equal(body.member.id, "mem1");
});

// ===========================================================================
// DELETE /api/classrooms/[id]/members/[userId]
// ===========================================================================

test("DELETE /api/classrooms/[id]/members/[userId] returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await deleteClassroomMember("c1", "u2");
  assert.equal(res.status, 401);
});

test("DELETE /api/classrooms/[id]/members/[userId] validates route params", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const { DELETE } = (await import("@/app/api/classrooms/[id]/members/[userid]/route")) as {
    DELETE: RouteHandler;
  };
  const res = await DELETE(
    deleteReq("http://test/api/classrooms/c1/members/"),
    withParams({ id: "c1", userid: "" }),
  );
  assert.equal(res.status, 400);
});

test("DELETE /api/classrooms/[id]/members/[userId] returns 404 when classroom not found", async () => {
  classroomStub = null;
  const res = await deleteClassroomMember("missing", "u2");
  assert.equal(res.status, 404);
});

test("DELETE /api/classrooms/[id]/members/[userId] returns 403 when caller cannot manage classroom", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  const res = await deleteClassroomMember("c1", "u2");
  assert.equal(res.status, 403);
});

test("DELETE /api/classrooms/[id]/members/[userId] returns 200 and removes the member on success", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const res = await deleteClassroomMember("c1", "u2");
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean };
  assert.equal(body.ok, true);
  assert.deepEqual(removeClassroomMemberCalls, [{ classroomId: "c1", userId: "u2" }]);
});

// ===========================================================================
// POST /api/classrooms/[id]/assignments
// ===========================================================================

test("POST /api/classrooms/[id]/assignments returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await postClassroomAssignment("c1", { articleId: "a1" });
  assert.equal(res.status, 401);
});

test("POST /api/classrooms/[id]/assignments returns 403 when caller cannot manage classroom", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  const res = await postClassroomAssignment("c1", { articleId: "a1" });
  assert.equal(res.status, 403);
});

test("POST /api/classrooms/[id]/assignments returns 404 when article not found", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  articleStub = null;
  const res = await postClassroomAssignment("c1", { articleId: "missing-article" });
  assert.equal(res.status, 404);
  const body = await res.json() as { error: string };
  assert.match(body.error, /article/i);
});

test("POST /api/classrooms/[id]/assignments returns 400 for an invalid due date", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const res = await postClassroomAssignment("c1", { articleId: "a1", dueDate: "not-a-date" });
  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.match(body.error, /due date/i);
});

test("POST /api/classrooms/[id]/assignments returns 409 for invalid article organization scope", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  articleAssignmentFailure = {
    status: 409,
    reason: "org_reference_orphaned",
  };

  const res = await postClassroomAssignment("c1", { articleId: "a1" });

  assert.equal(res.status, 409);
  const body = await res.json() as { error: string };
  assert.match(body.error, /organization scope/i);
});

test("POST /api/classrooms/[id]/assignments returns 201 with assignment on success", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const res = await postClassroomAssignment("c1", {
    articleId: "a1",
    dueDate: "2026-12-31",
    instructions: "Read carefully",
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { assignment: { id: string } };
  assert.equal(body.assignment.id, "asgn1");
});

// ===========================================================================
// DELETE /api/assignments/[id]
// ===========================================================================

test("DELETE /api/assignments/[id] returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await deleteAssignmentRoute("asgn1");
  assert.equal(res.status, 401);
});

test("DELETE /api/assignments/[id] returns 404 when assignment is missing", async () => {
  assignmentClassroomResult = null;
  const res = await deleteAssignmentRoute("missing");
  assert.equal(res.status, 404);
});

test("DELETE /api/assignments/[id] enforces tenant isolation with classroom-manage guard", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1" };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  const res = await deleteAssignmentRoute("asgn1");
  assert.equal(res.status, 403);
});

test("DELETE /api/assignments/[id] returns 200 and deletes assignment on success", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1" };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const res = await deleteAssignmentRoute("asgn1");
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean };
  assert.equal(body.ok, true);
  assert.deepEqual(deleteAssignmentCalls, ["asgn1"]);
});

// ===========================================================================
// PATCH /api/assignments/[id]
// ===========================================================================

test("PATCH /api/assignments/[id] returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await patchAssignmentRoute("asgn1", { instructions: "Read closely" });
  assert.equal(res.status, 401);
});

test("PATCH /api/assignments/[id] returns 404 when assignment is missing", async () => {
  assignmentClassroomResult = null;
  const res = await patchAssignmentRoute("missing", { instructions: "x" });
  assert.equal(res.status, 404);
});

test("PATCH /api/assignments/[id] enforces tenant isolation with classroom-manage guard", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1" };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  const res = await patchAssignmentRoute("asgn1", { instructions: "x" });
  assert.equal(res.status, 403);
  assert.equal(updateAssignmentCalls.length, 0);
});

test("PATCH /api/assignments/[id] updates dueDate + instructions for the classroom teacher", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1" };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  updateAssignmentResult = {
    ok: true,
    assignment: {
      id: "asgn1",
      classroomId: "c1",
      dueDate: "2026-08-01T00:00:00.000Z",
      instructions: "Focus on the intro",
    },
  };
  const res = await patchAssignmentRoute("asgn1", {
    dueDate: "2026-08-01T00:00:00.000Z",
    instructions: "Focus on the intro",
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { assignment: { instructions: string } };
  assert.equal(body.assignment.instructions, "Focus on the intro");
  assert.deepEqual(updateAssignmentCalls, [
    {
      assignmentId: "asgn1",
      input: {
        dueDate: "2026-08-01T00:00:00.000Z",
        instructions: "Focus on the intro",
      },
    },
  ]);
});

test("PATCH /api/assignments/[id] returns 400 when the due date is invalid", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1" };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  updateAssignmentResult = { ok: false, status: 400, reason: "invalid_due_date" };
  const res = await patchAssignmentRoute("asgn1", { dueDate: "not-a-date" });
  assert.equal(res.status, 400);
});

// ===========================================================================
// POST /api/assignments/[id]/completion
// ===========================================================================

test("POST /api/assignments/[id]/completion returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await postAssignmentCompletion("asgn1", { status: "COMPLETED" });
  assert.equal(res.status, 401);
});

test("POST /api/assignments/[id]/completion returns 404 when student is not in the classroom", async () => {
  assignmentContext = null;
  const res = await postAssignmentCompletion("asgn-x", { status: "COMPLETED" });
  assert.equal(res.status, 404);
});

test("POST /api/assignments/[id]/completion returns 201 with completion record on success", async () => {
  const res = await postAssignmentCompletion("asgn1", { status: "COMPLETED", quizScore: 90 });
  assert.equal(res.status, 201);
  const body = await res.json() as { ok: boolean; completion: { id: string } };
  assert.equal(body.ok, true);
  assert.equal(body.completion.id, "comp1");
});
