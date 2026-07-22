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
let classroomStub: { id: string; orgId: string; teacherId: string; archivedAt?: Date | null } | null = {
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
let archivedClassroomListResult: Array<Record<string, unknown>> = [
  {
    id: "archived-1",
    orgId: "org-1",
    teacherId: "teacher-1",
    name: "Archived Class",
    archivedAt: "2026-07-21T03:00:00.000Z",
  },
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
let assignmentContext: { id: string; classroomArchivedAt?: Date | null } | null = { id: "asgn1" };
let assignmentClassroomResult: { id: string; classroomId: string; points?: number | null } | null = {
  id: "asgn1",
  classroomId: "c1",
  points: 20,
};
let articleAssignmentFailure: {
  status: 400 | 404 | 409;
  reason: "invalid_due_date" | "invalid_target_students" | "article_not_found" | "org_reference_orphaned";
} | null = null;
let remindResult: { total: number; notified: number; skipped: number; suppressed: number } | null = {
  total: 3,
  notified: 2,
  skipped: 1,
  suppressed: 0,
};
let reopenResult: { reopened: number } = { reopened: 2 };
const removeClassroomMemberCalls: Array<{ classroomId: string; userId: string }> = [];
const updateClassroomLifecycleCalls: Array<{
  classroomId: string;
  input: { name?: string; archived?: boolean };
}> = [];
let updateClassroomLifecycleResult:
  | {
      ok: true;
      classroom: Record<string, unknown>;
      changed: { name: boolean; archived: boolean };
    }
  | { ok: false; status: 400; reason: "empty_update" } = {
  ok: true,
  classroom: { id: "c1", name: "Class 1", orgId: "org-1", teacherId: "teacher-1", archivedAt: null },
  changed: { name: true, archived: false },
};
const deleteClassroomCalls: string[] = [];
let deleteClassroomResult:
  | { ok: true; deleted: boolean }
  | {
      ok: false;
      status: 409;
      reason: "classroom_not_empty";
      assignmentCount: number;
      memberCount: number;
    } = { ok: true, deleted: true };
const deleteAssignmentCalls: string[] = [];
const updateAssignmentCalls: Array<{
  assignmentId: string;
  input: {
    dueDate?: string;
    instructions?: string | null;
    title?: string | null;
    points?: number | null;
    studentIds?: string[];
  };
}> = [];
const createArticleAssignmentCalls: Array<{
  articleId?: string;
  title?: string | null;
  points?: number | null;
  dueDate?: string;
  instructions?: string | null;
  studentIds?: string[];
}> = [];
const reopenAssignmentCalls: string[] = [];
const articleAssignmentFailuresById = new Map<string, {
  status: 400 | 404 | 409;
  reason: "invalid_due_date" | "invalid_target_students" | "article_not_found" | "org_reference_orphaned";
}>();
const recordAssignmentCompletionCalls: Array<{
  assignmentId: string;
  studentId: string;
  input: { status?: string; quizScore?: number };
}> = [];
const reviewAssignmentCompletionCalls: Array<{
  assignmentId: string;
  studentId: string;
  input: { feedback: string | null; pointsAwarded?: number | null; reviewedBy: string };
}> = [];
let updateAssignmentResult:
  | { ok: true; assignment: Record<string, unknown> }
  | { ok: false; status: 400 | 409; reason: "invalid_due_date" | "invalid_target_students" | "points_below_awarded" } = {
  ok: true,
  assignment: { id: "asgn1", classroomId: "c1", dueDate: null, instructions: null },
};
let assignmentDetailResult: unknown = null;

// org stubs — controls requireOrgCapabilityApi (for POST /classrooms) and
// the inline RBAC check in GET /classrooms/[id]/analytics.
// isOrgAdminStub = true → hasOrgCapability() returns true in both paths.
let membershipStub: { role: string } | null = null;
let targetMembershipStub: { role: string } | null = { role: "Member" };
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
const auditCalls: Array<{
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}> = [];

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
      listArchivedClassroomsForTeacher: async () => archivedClassroomListResult,
      createClassroom: async () => createClassroomResult,
      addClassroomMember: async () => addMemberResult,
      removeClassroomMember: async (classroomId: string, userId: string) => {
        removeClassroomMemberCalls.push({ classroomId, userId });
      },
      updateClassroomLifecycle: async (
        classroomId: string,
        input: { name?: string; archived?: boolean },
      ) => {
        updateClassroomLifecycleCalls.push({ classroomId, input });
        return updateClassroomLifecycleResult;
      },
      deleteClassroom: async (classroomId: string) => {
        deleteClassroomCalls.push(classroomId);
        return deleteClassroomResult;
      },
      getAssignmentClassroom: async () => assignmentClassroomResult,
      getAssignmentDetail: async () => assignmentDetailResult,
      deleteAssignment: async (assignmentId: string) => {
        deleteAssignmentCalls.push(assignmentId);
      },
      reopenAssignment: async (assignmentId: string) => {
        reopenAssignmentCalls.push(assignmentId);
        return reopenResult;
      },
      updateAssignment: async (
        assignmentId: string,
        input: {
          dueDate?: string;
          instructions?: string | null;
          title?: string | null;
          points?: number | null;
          studentIds?: string[];
        },
      ) => {
        updateAssignmentCalls.push({ assignmentId, input });
        return updateAssignmentResult;
      },
      getStudentAssignmentContext: async () => assignmentContext,
      recordAssignmentCompletion: async (
        assignmentId: string,
        studentId: string,
        input: { status?: string; quizScore?: number },
      ) => {
        recordAssignmentCompletionCalls.push({ assignmentId, studentId, input });
        return completionResult;
      },
      reviewAssignmentCompletion: async (
        assignmentId: string,
        studentId: string,
        input: { feedback: string | null; pointsAwarded?: number | null; reviewedBy: string },
      ) => {
        reviewAssignmentCompletionCalls.push({ assignmentId, studentId, input });
        return { ...completionResult, pointsAwarded: input.pointsAwarded ?? null };
      },
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
      createArticleAssignment: async (input: {
        articleId?: string;
        dueDate?: string;
        instructions?: string | null;
        title?: string | null;
        points?: number | null;
        studentIds?: string[];
      }) => {
        createArticleAssignmentCalls.push(input);
        if (input.articleId && articleAssignmentFailuresById.has(input.articleId)) {
          return { ok: false, ...articleAssignmentFailuresById.get(input.articleId) };
        }
        if (articleAssignmentFailure) {
          return { ok: false, ...articleAssignmentFailure };
        }
        if (!articleStub) {
          return { ok: false, status: 404, reason: "article_not_found" };
        }
        if (input.dueDate && Number.isNaN(new Date(input.dueDate).getTime())) {
          return { ok: false, status: 400, reason: "invalid_due_date" };
        }
        return { ok: true, assignment: { ...assignArticleResult, title: input.title ?? null, points: input.points ?? null } };
      },
      bulkCreateArticleAssignments: async (input: {
        articleIds: string[];
        dueDate?: string;
        instructions?: string | null;
        points?: number | null;
        studentIds?: string[];
      }) => {
        const created: Array<Record<string, unknown>> = [];
        const failed: Array<{ articleId: string; reason: string }> = [];
        for (const articleId of input.articleIds) {
          createArticleAssignmentCalls.push({
            articleId,
            dueDate: input.dueDate,
            instructions: input.instructions,
            points: input.points,
            title: null,
            studentIds: input.studentIds,
          });
          const perArticleFailure = articleAssignmentFailuresById.get(articleId);
          if (perArticleFailure) {
            failed.push({ articleId, reason: perArticleFailure.reason });
            continue;
          }
          if (articleAssignmentFailure) {
            failed.push({ articleId, reason: articleAssignmentFailure.reason });
            continue;
          }
          if (!articleStub) {
            failed.push({ articleId, reason: "article_not_found" });
            continue;
          }
          if (input.dueDate && Number.isNaN(new Date(input.dueDate).getTime())) {
            failed.push({ articleId, reason: "invalid_due_date" });
            continue;
          }
          created.push({ ...assignArticleResult, id: `asgn-${articleId}`, articleId, points: input.points ?? null });
        }
        return { created, failed };
      },
    },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      articleAccessContext: (
        user: { id?: string | null; role?: string | null },
        orgId?: string | null,
      ) => ({
        userId: user.id ?? null,
        role: user.role ?? null,
        ...(orgId ? { orgId } : {}),
      }),
    },
  });

  // @/lib/org — kept for route modules that still consume the barrel directly.
  mock.module("@/lib/org", {
    namedExports: {
      getMembership: async (userId: string) =>
        userId === currentSession.user.id ? membershipStub : targetMembershipStub,
      // hasOrgCapability controls both requireOrgCapabilityApi (POST /classrooms) and
      // the inline isOrgAdmin check in the analytics route.
      hasOrgCapability: () => isOrgAdminStub,
      isSystemAdmin: () => false,
      // re-export canManageClassroom alias that tenant-api doesn't use via org barrel
    },
  });
  mock.module("@/lib/org/queries", {
    namedExports: {
      getMembership: async (userId: string) =>
        userId === currentSession.user.id ? membershipStub : targetMembershipStub,
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
  mock.module("@/lib/security/audit", {
    namedExports: {
      AUDIT_ACTIONS: {
        securityAdminAccessDenied: "security.admin_access_denied",
        classroomRename: "classroom.rename",
        classroomArchive: "classroom.archive",
        classroomUnarchive: "classroom.unarchive",
        classroomDelete: "classroom.delete",
        classroomMemberAdd: "classroom.member.add",
        classroomMemberRemove: "classroom.member.remove",
        assignmentUpdate: "assignment.update",
        assignmentDelete: "assignment.delete",
        assignmentCreate: "assignment.create",
        assignmentRemind: "assignment.remind",
        assignmentReopen: "assignment.reopen",
        assignmentReview: "assignment.review",
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
  mock.module("@/lib/push/assignment-reminders", {
    namedExports: {
      remindAssignmentStudents: async () => remindResult,
    },
  });
});

beforeEach(() => {
  authState = "ok";
  currentSession = readerSession;
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  createClassroomResult = { id: "c1", name: "Class 1", orgId: "org-1" };
  classroomListResult = [{ id: "c1", orgId: "org-1", teacherId: "teacher-1", name: "Class 1" }];
  archivedClassroomListResult = [
    {
      id: "archived-1",
      orgId: "org-1",
      teacherId: "teacher-1",
      name: "Archived Class",
      archivedAt: "2026-07-21T03:00:00.000Z",
    },
  ];
  addMemberResult = { id: "mem1", userId: "u2", classroomId: "c1", role: "Student" };
  assignArticleResult = { id: "asgn1", classroomId: "c1", articleId: "a1", dueDate: null };
  completionResult = { id: "comp1", userId: "user-1", assignmentId: "asgn1", status: "COMPLETED" };
  assignmentContext = { id: "asgn1" };
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  articleAssignmentFailure = null;
  membershipStub = null;
  targetMembershipStub = { role: "Member" };
  isOrgAdminStub = false;
  analyticsViewerRoleStub = "teacher";
  analyticsDataStub = { classroomId: "c1", completionRate: 0.75, members: [] };
  articleStub = { id: "a1" };
  removeClassroomMemberCalls.length = 0;
  updateClassroomLifecycleCalls.length = 0;
  updateClassroomLifecycleResult = {
    ok: true,
    classroom: { id: "c1", name: "Class 1", orgId: "org-1", teacherId: "teacher-1", archivedAt: null },
    changed: { name: true, archived: false },
  };
  deleteClassroomCalls.length = 0;
  deleteClassroomResult = { ok: true, deleted: true };
  deleteAssignmentCalls.length = 0;
  updateAssignmentCalls.length = 0;
  createArticleAssignmentCalls.length = 0;
  articleAssignmentFailuresById.clear();
  recordAssignmentCompletionCalls.length = 0;
  reviewAssignmentCompletionCalls.length = 0;
  reopenAssignmentCalls.length = 0;
  assignmentDetailResult = null;
  updateAssignmentResult = {
    ok: true,
    assignment: { id: "asgn1", classroomId: "c1", dueDate: null, instructions: null },
  };
  remindResult = { total: 3, notified: 2, skipped: 1, suppressed: 0 };
  reopenResult = { reopened: 2 };
  auditCalls.length = 0;
});

async function postClassrooms(body: Record<string, unknown>) {
  const { POST } = (await import("@/app/api/classrooms/route")) as { POST: RouteHandler };
  return POST(jsonPost("http://test/api/classrooms", body));
}

async function getClassrooms(query = "") {
  const { GET } = (await import("@/app/api/classrooms/route")) as { GET: RouteHandler };
  return GET(getReq(`http://test/api/classrooms${query}`));
}

async function getClassroom(id = "c1") {
  const { GET } = (await import("@/app/api/classrooms/[id]/route")) as { GET: RouteHandler };
  return GET(getReq(`http://test/api/classrooms/${id}`), withParams({ id }));
}

async function patchClassroom(id: string, body: Record<string, unknown>) {
  const { PATCH } = (await import("@/app/api/classrooms/[id]/route")) as { PATCH: RouteHandler };
  return PATCH(jsonPatch(`http://test/api/classrooms/${id}`, body), withParams({ id }));
}

async function deleteClassroomRoute(id: string) {
  const { DELETE } = (await import("@/app/api/classrooms/[id]/route")) as {
    DELETE: RouteHandler;
  };
  return DELETE(deleteReq(`http://test/api/classrooms/${id}`), withParams({ id }));
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

async function postBulkClassroomAssignments(id: string, body: Record<string, unknown>) {
  const { POST } = (await import("@/app/api/classrooms/[id]/assignments/bulk/route")) as {
    POST: RouteHandler;
  };
  return POST(jsonPost(`http://test/api/classrooms/${id}/assignments/bulk`, body), withParams({ id }));
}

async function patchAssignmentCompletionReview(id: string, studentId: string, body: Record<string, unknown>) {
  const { PATCH } = (await import("@/app/api/assignments/[id]/completions/[studentId]/route")) as {
    PATCH: RouteHandler;
  };
  return PATCH(
    jsonPatch(`http://test/api/assignments/${id}/completions/${studentId}`, body),
    withParams({ id, studentId }),
  );
}

async function postAssignmentCompletion(id: string, body: Record<string, unknown>) {
  const { POST } = (await import("@/app/api/assignments/[id]/completion/route")) as {
    POST: RouteHandler;
  };
  return POST(jsonPost(`http://test/api/assignments/${id}/completion`, body), withParams({ id }));
}

async function getAssignmentRoute(id: string) {
  const { GET } = (await import("@/app/api/assignments/[id]/route")) as {
    GET: RouteHandler;
  };
  return GET(getReq(`http://test/api/assignments/${id}`), withParams({ id }));
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

async function remindAssignmentRoute(id: string) {
  const { POST } = (await import("@/app/api/assignments/[id]/remind/route")) as {
    POST: RouteHandler;
  };
  return POST(jsonPost(`http://test/api/assignments/${id}/remind`, {}), withParams({ id }));
}

async function reopenAssignmentRoute(id: string) {
  const { POST } = (await import("@/app/api/assignments/[id]/reopen/route")) as {
    POST: RouteHandler;
  };
  return POST(jsonPost(`http://test/api/assignments/${id}/reopen`, {}), withParams({ id }));
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

test("GET /api/classrooms?archived=true returns archived teacher-managed classrooms", async () => {
  classroomListResult = [
    { id: "active-1", orgId: "org-1", teacherId: "teacher-1", name: "Active Class" },
  ];
  archivedClassroomListResult = [
    {
      id: "archived-1",
      orgId: "org-1",
      teacherId: "teacher-1",
      name: "Archived Class",
      archivedAt: "2026-07-21T03:00:00.000Z",
    },
  ];
  const res = await getClassrooms("?archived=true");
  assert.equal(res.status, 200);
  const body = await res.json() as { classrooms: Array<{ id: string; archivedAt: string | null }> };
  assert.equal(body.classrooms.length, 1);
  assert.equal(body.classrooms[0].id, "archived-1");
  assert.ok(body.classrooms[0].archivedAt);
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
// PATCH /api/classrooms/[id]
// ===========================================================================

test("PATCH /api/classrooms/[id] requires manage access", async () => {
  currentSession = { user: { id: "learner-1", role: "Reader", name: "L", email: "l@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  const res = await patchClassroom("c1", { name: "Renamed" });
  assert.equal(res.status, 403);
  assert.equal(updateClassroomLifecycleCalls.length, 0);
});

test("PATCH /api/classrooms/[id] renames and audits a classroom", async () => {
  currentSession = { user: { id: "teacher-1", role: "Reader", name: "T", email: "t@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  updateClassroomLifecycleResult = {
    ok: true,
    classroom: { id: "c1", name: "Renamed", orgId: "org-1", teacherId: "teacher-1", archivedAt: null },
    changed: { name: true, archived: false },
  };
  const res = await patchClassroom("c1", { name: "Renamed" });
  assert.equal(res.status, 200);
  assert.deepEqual(updateClassroomLifecycleCalls, [{ classroomId: "c1", input: { name: "Renamed" } }]);
  assert.equal(auditCalls.at(-1)?.action, "classroom.rename");
  assert.equal(auditCalls.at(-1)?.targetId, "c1");
});

test("PATCH /api/classrooms/[id] rejects renaming an archived classroom", async () => {
  currentSession = { user: { id: "teacher-1", role: "Reader", name: "T", email: "t@e.com" } };
  classroomStub = {
    id: "c1",
    orgId: "org-1",
    teacherId: "teacher-1",
    archivedAt: new Date("2026-07-21T03:00:00.000Z"),
  };
  const res = await patchClassroom("c1", { name: "Renamed" });
  assert.equal(res.status, 409);
  const body = await res.json() as { error: string };
  assert.match(body.error, /archived/i);
  assert.equal(updateClassroomLifecycleCalls.length, 0);
});

test("PATCH /api/classrooms/[id] archives and unarchives with audit actions", async () => {
  currentSession = { user: { id: "teacher-1", role: "Reader", name: "T", email: "t@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  updateClassroomLifecycleResult = {
    ok: true,
    classroom: {
      id: "c1",
      name: "Class 1",
      orgId: "org-1",
      teacherId: "teacher-1",
      archivedAt: new Date("2026-07-21T03:00:00.000Z"),
    },
    changed: { name: false, archived: true },
  };
  let res = await patchClassroom("c1", { archived: true });
  assert.equal(res.status, 200);
  assert.equal(auditCalls.at(-1)?.action, "classroom.archive");

  updateClassroomLifecycleResult = {
    ok: true,
    classroom: { id: "c1", name: "Class 1", orgId: "org-1", teacherId: "teacher-1", archivedAt: null },
    changed: { name: false, archived: true },
  };
  classroomStub = {
    id: "c1",
    orgId: "org-1",
    teacherId: "teacher-1",
    archivedAt: new Date("2026-07-21T03:00:00.000Z"),
  };
  res = await patchClassroom("c1", { archived: false });
  assert.equal(res.status, 200);
  assert.equal(auditCalls.at(-1)?.action, "classroom.unarchive");
});

test("PATCH /api/classrooms/[id] rejects an empty lifecycle body", async () => {
  currentSession = { user: { id: "teacher-1", role: "Reader", name: "T", email: "t@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  updateClassroomLifecycleResult = { ok: false, status: 400, reason: "empty_update" };
  const res = await patchClassroom("c1", {});
  assert.equal(res.status, 400);
  assert.equal(auditCalls.length, 0);
});

// ===========================================================================
// DELETE /api/classrooms/[id]
// ===========================================================================

test("DELETE /api/classrooms/[id] requires manage access", async () => {
  currentSession = { user: { id: "learner-1", role: "Reader", name: "L", email: "l@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  const res = await deleteClassroomRoute("c1");
  assert.equal(res.status, 403);
  assert.equal(deleteClassroomCalls.length, 0);
});

test("DELETE /api/classrooms/[id] blocks non-empty classrooms", async () => {
  currentSession = { user: { id: "teacher-1", role: "Reader", name: "T", email: "t@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  deleteClassroomResult = {
    ok: false,
    status: 409,
    reason: "classroom_not_empty",
    assignmentCount: 1,
    memberCount: 2,
  };
  const res = await deleteClassroomRoute("c1");
  assert.equal(res.status, 409);
  assert.equal(auditCalls.length, 0);
});

test("DELETE /api/classrooms/[id] deletes empty classrooms and audits", async () => {
  currentSession = { user: { id: "teacher-1", role: "Reader", name: "T", email: "t@e.com" } };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "teacher-1" };
  const res = await deleteClassroomRoute("c1");
  assert.equal(res.status, 200);
  assert.deepEqual(deleteClassroomCalls, ["c1"]);
  assert.equal(auditCalls.at(-1)?.action, "classroom.delete");
  assert.equal(auditCalls.at(-1)?.metadata?.deleted, true);
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
    drilldown: { filters: { assignmentId: "a1" }, rows: [{ assignmentId: "a1", articleTitle: "Article 1", studentId: "s1", name: "Sam", email: "s@example.com", status: "COMPLETED", quizScore: 90, completionSource: null, dueDate: null, completedAt: null }] },
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
        completionSource: null,
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

test("POST /api/classrooms/[id]/members rejects users outside the classroom org", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  targetMembershipStub = null;

  const res = await postClassroomMember("c1", { userId: "outside-org", role: "Student" });

  assert.equal(res.status, 403);
});

test("POST /api/classrooms/[id]/members rejects archived classrooms", async () => {
  classroomStub = {
    id: "c1",
    orgId: "org-1",
    teacherId: "user-1",
    archivedAt: new Date("2026-07-21T03:00:00.000Z"),
  };
  const res = await postClassroomMember("c1", { userId: "u2", role: "Student" });
  assert.equal(res.status, 409);
  const body = await res.json() as { error: string };
  assert.match(body.error, /archived/i);
});

test("POST /api/classrooms/[id]/members returns 201 and new member on success", async () => {
  // teacherId === user-1 (readerSession) → canManageClassroom = true
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const res = await postClassroomMember("c1", { userId: "u2", role: "Student" });
  assert.equal(res.status, 201);
  const body = await res.json() as { ok: boolean; member: { id: string } };
  assert.equal(body.ok, true);
  assert.equal(body.member.id, "mem1");
  assert.equal(auditCalls.at(-1)?.action, "classroom.member.add");
  assert.equal(auditCalls.at(-1)?.targetType, "classroom_member");
  assert.deepEqual(auditCalls.at(-1)?.metadata, {
    classroomId: "c1",
    orgId: "org-1",
    targetUserId: "u2",
    role: "Student",
  });
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

test("DELETE /api/classrooms/[id]/members/[userId] rejects archived classrooms", async () => {
  classroomStub = {
    id: "c1",
    orgId: "org-1",
    teacherId: "user-1",
    archivedAt: new Date("2026-07-21T03:00:00.000Z"),
  };
  const res = await deleteClassroomMember("c1", "u2");
  assert.equal(res.status, 409);
  assert.equal(removeClassroomMemberCalls.length, 0);
});

test("DELETE /api/classrooms/[id]/members/[userId] returns 200 and removes the member on success", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const res = await deleteClassroomMember("c1", "u2");
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean };
  assert.equal(body.ok, true);
  assert.deepEqual(removeClassroomMemberCalls, [{ classroomId: "c1", userId: "u2" }]);
  assert.equal(auditCalls.at(-1)?.action, "classroom.member.remove");
  assert.deepEqual(auditCalls.at(-1)?.metadata, {
    classroomId: "c1",
    orgId: "org-1",
    targetUserId: "u2",
  });
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

test("POST /api/classrooms/[id]/assignments rejects archived classrooms", async () => {
  classroomStub = {
    id: "c1",
    orgId: "org-1",
    teacherId: "user-1",
    archivedAt: new Date("2026-07-21T03:00:00.000Z"),
  };
  const res = await postClassroomAssignment("c1", { articleId: "a1" });
  assert.equal(res.status, 409);
});

test("POST /api/classrooms/[id]/assignments returns 201 with assignment on success", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const res = await postClassroomAssignment("c1", {
    articleId: "a1",
    dueDate: "2026-12-31",
    instructions: "Read carefully",
    title: "Week 1 reading",
    points: 20,
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { assignment: { id: string; title: string | null; points: number | null } };
  assert.equal(body.assignment.id, "asgn1");
  assert.equal(body.assignment.title, "Week 1 reading");
  assert.equal(body.assignment.points, 20);
  assert.equal(createArticleAssignmentCalls.at(-1)?.title, "Week 1 reading");
  assert.equal(createArticleAssignmentCalls.at(-1)?.points, 20);
  assert.equal(createArticleAssignmentCalls.at(-1)?.dueDate, "2026-12-31");
  assert.equal(auditCalls.at(-1)?.action, "assignment.create");
  assert.equal(auditCalls.at(-1)?.targetType, "classroom");
  assert.equal(auditCalls.at(-1)?.targetId, "c1");
  assert.deepEqual(auditCalls.at(-1)?.metadata, {
    classroomId: "c1",
    assignmentId: "asgn1",
    articleId: "a1",
    targeted: 0,
  });
});

test("POST /api/classrooms/[id]/assignments forwards target studentIds", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };

  const res = await postClassroomAssignment("c1", {
    articleId: "a1",
    studentIds: ["student-1", "student-2"],
  });

  assert.equal(res.status, 201);
  assert.deepEqual(createArticleAssignmentCalls.at(-1)?.studentIds, [
    "student-1",
    "student-2",
  ]);
  assert.deepEqual(auditCalls.at(-1)?.metadata, {
    classroomId: "c1",
    assignmentId: "asgn1",
    articleId: "a1",
    targeted: 2,
  });
});

test("POST /api/classrooms/[id]/assignments maps invalid target students to 400", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  articleAssignmentFailure = {
    status: 400,
    reason: "invalid_target_students",
  };

  const res = await postClassroomAssignment("c1", {
    articleId: "a1",
    studentIds: ["missing-student"],
  });

  assert.equal(res.status, 400);
  const body = await res.json() as { error: string };
  assert.equal(body.error, "Select at least one enrolled student to target");
  assert.equal(auditCalls.length, 0);
});

test("POST /api/classrooms/[id]/assignments rejects out-of-range points", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const res = await postClassroomAssignment("c1", { articleId: "a1", points: 10001 });
  assert.equal(res.status, 400);
  assert.equal(createArticleAssignmentCalls.length, 0);
});

// ===========================================================================
// POST /api/classrooms/[id]/assignments/bulk
// ===========================================================================

test("POST /api/classrooms/[id]/assignments/bulk returns 201 with created and failed", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  articleAssignmentFailuresById.set("a2", { status: 404, reason: "article_not_found" });

  const res = await postBulkClassroomAssignments("c1", {
    articleIds: ["a1", "a2", "a3"],
    dueDate: "2026-12-31",
    instructions: "Read carefully",
    points: 20,
  });

  assert.equal(res.status, 201);
  const body = await res.json() as {
    created: Array<{ articleId: string; points: number | null }>;
    failed: Array<{ articleId: string; reason: string }>;
  };
  assert.deepEqual(body.created.map((assignment) => assignment.articleId), ["a1", "a3"]);
  assert.deepEqual(body.failed, [{ articleId: "a2", reason: "article_not_found" }]);
  assert.deepEqual(
    createArticleAssignmentCalls.map((call) => call.articleId),
    ["a1", "a2", "a3"],
  );
  assert.deepEqual(auditCalls.at(-1)?.metadata, {
    classroomId: "c1",
    requested: 3,
    created: 2,
    failed: 1,
    targeted: false,
  });
});


test("POST /api/classrooms/[id]/assignments/bulk forwards target studentIds and audits targeted flag", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };

  const res = await postBulkClassroomAssignments("c1", {
    articleIds: ["a1", "a2"],
    studentIds: ["student-1", "student-2"],
  });

  assert.equal(res.status, 201);
  assert.deepEqual(
    createArticleAssignmentCalls.map((call) => call.studentIds),
    [["student-1", "student-2"], ["student-1", "student-2"]],
  );
  assert.deepEqual(auditCalls.at(-1)?.metadata, {
    classroomId: "c1",
    requested: 2,
    created: 2,
    failed: 0,
    targeted: true,
  });
});

test("POST /api/classrooms/[id]/assignments/bulk returns 400 for an empty array", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const res = await postBulkClassroomAssignments("c1", { articleIds: [] });
  assert.equal(res.status, 400);
  assert.equal(createArticleAssignmentCalls.length, 0);
});

test("POST /api/classrooms/[id]/assignments/bulk returns 403 when caller cannot manage classroom", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  const res = await postBulkClassroomAssignments("c1", { articleIds: ["a1"] });
  assert.equal(res.status, 403);
  assert.equal(createArticleAssignmentCalls.length, 0);
});

test("POST /api/classrooms/[id]/assignments/bulk surfaces article-access failures in failed", async () => {
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  articleAssignmentFailuresById.set("restricted", { status: 404, reason: "article_not_found" });

  const res = await postBulkClassroomAssignments("c1", { articleIds: ["restricted"] });

  assert.equal(res.status, 201);
  const body = await res.json() as { created: unknown[]; failed: Array<{ articleId: string; reason: string }> };
  assert.deepEqual(body.created, []);
  assert.deepEqual(body.failed, [{ articleId: "restricted", reason: "article_not_found" }]);
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
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  const res = await deleteAssignmentRoute("asgn1");
  assert.equal(res.status, 403);
});

test("DELETE /api/assignments/[id] rejects archived classrooms", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = {
    id: "c1",
    orgId: "org-1",
    teacherId: "user-1",
    archivedAt: new Date("2026-07-21T03:00:00.000Z"),
  };
  const res = await deleteAssignmentRoute("asgn1");
  assert.equal(res.status, 409);
  assert.equal(deleteAssignmentCalls.length, 0);
});

test("DELETE /api/assignments/[id] returns 200 and deletes assignment on success", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const res = await deleteAssignmentRoute("asgn1");
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean };
  assert.equal(body.ok, true);
  assert.deepEqual(deleteAssignmentCalls, ["asgn1"]);
  assert.equal(auditCalls.at(-1)?.action, "assignment.delete");
  assert.deepEqual(auditCalls.at(-1)?.metadata, {
    assignmentId: "asgn1",
    classroomId: "c1",
  });
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
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  const res = await patchAssignmentRoute("asgn1", { instructions: "x" });
  assert.equal(res.status, 403);
  assert.equal(updateAssignmentCalls.length, 0);
});

test("PATCH /api/assignments/[id] rejects archived classrooms", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = {
    id: "c1",
    orgId: "org-1",
    teacherId: "user-1",
    archivedAt: new Date("2026-07-21T03:00:00.000Z"),
  };
  const res = await patchAssignmentRoute("asgn1", { instructions: "x" });
  assert.equal(res.status, 409);
  assert.equal(updateAssignmentCalls.length, 0);
});

test("PATCH /api/assignments/[id] updates dueDate + instructions for the classroom teacher", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  updateAssignmentResult = {
    ok: true,
    assignment: {
      id: "asgn1",
      classroomId: "c1",
      dueDate: "2026-08-01T00:00:00.000Z",
      instructions: "Focus on the intro",
      title: "Unit 2",
      points: 30,
    },
  };
  const res = await patchAssignmentRoute("asgn1", {
    dueDate: "2026-08-01T00:00:00.000Z",
    instructions: "Focus on the intro",
    title: "Unit 2",
    points: 30,
    studentIds: ["s1", "s2"],
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
        title: "Unit 2",
        points: 30,
        studentIds: ["s1", "s2"],
      },
    },
  ]);
  assert.equal(auditCalls.at(-1)?.action, "assignment.update");
  assert.deepEqual(auditCalls.at(-1)?.metadata, {
    assignmentId: "asgn1",
    classroomId: "c1",
    changed: { dueDate: true, instructions: true, title: true, points: true, targets: true },
  });
  assert.equal(JSON.stringify(auditCalls.at(-1)?.metadata).includes("Focus on the intro"), false);
  assert.equal(JSON.stringify(auditCalls.at(-1)?.metadata).includes("Unit 2"), false);
});

test("PATCH /api/assignments/[id] forwards clearable dueDate, points, and whole-class targets", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const res = await patchAssignmentRoute("asgn1", {
    dueDate: "",
    instructions: "",
    title: "",
    points: null,
    studentIds: [],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(updateAssignmentCalls.at(-1), {
    assignmentId: "asgn1",
    input: {
      dueDate: "",
      instructions: "",
      title: "",
      points: null,
      studentIds: [],
    },
  });
  assert.deepEqual(auditCalls.at(-1)?.metadata, {
    assignmentId: "asgn1",
    classroomId: "c1",
    changed: { dueDate: true, instructions: true, title: true, points: true, targets: true },
  });
});

test("PATCH /api/assignments/[id] rejects out-of-range points", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  const res = await patchAssignmentRoute("asgn1", { points: -1 });
  assert.equal(res.status, 400);
  assert.equal(updateAssignmentCalls.length, 0);
});

test("PATCH /api/assignments/[id] returns 400 when the due date is invalid", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  updateAssignmentResult = { ok: false, status: 400, reason: "invalid_due_date" };
  const res = await patchAssignmentRoute("asgn1", { dueDate: "not-a-date" });
  assert.equal(res.status, 400);
});

test("PATCH /api/assignments/[id] maps invalid target students to 400", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  updateAssignmentResult = { ok: false, status: 400, reason: "invalid_target_students" };
  const res = await patchAssignmentRoute("asgn1", { studentIds: ["ghost"] });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "Select at least one enrolled student to target");
});

test("PATCH /api/assignments/[id] maps points below awarded score to 409", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  updateAssignmentResult = { ok: false, status: 409, reason: "points_below_awarded" };

  const res = await patchAssignmentRoute("asgn1", { points: 10 });

  assert.equal(res.status, 409);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "Cannot set points below an already-awarded score");
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

test("POST /api/assignments/[id]/completion rejects archived classrooms", async () => {
  assignmentContext = {
    id: "asgn1",
    classroomArchivedAt: new Date("2026-07-21T03:00:00.000Z"),
  };
  const res = await postAssignmentCompletion("asgn1", { status: "COMPLETED" });
  assert.equal(res.status, 409);
  assert.equal(recordAssignmentCompletionCalls.length, 0);
});

test("POST /api/assignments/[id]/completion returns 201 with completion record on success", async () => {
  const res = await postAssignmentCompletion("asgn1", { status: "COMPLETED", quizScore: 90 });
  assert.equal(res.status, 201);
  const body = await res.json() as { ok: boolean; completion: { id: string } };
  assert.equal(body.ok, true);
  assert.equal(body.completion.id, "comp1");
});

// ===========================================================================
// PATCH /api/assignments/[id]/completions/[studentId]
// ===========================================================================

test("PATCH assignment completion review awards a score", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };

  const res = await patchAssignmentCompletionReview("asgn1", "student-1", {
    feedback: "Nice work",
    pointsAwarded: 18,
  });

  assert.equal(res.status, 200);
  assert.deepEqual(reviewAssignmentCompletionCalls.at(-1), {
    assignmentId: "asgn1",
    studentId: "student-1",
    input: { feedback: "Nice work", pointsAwarded: 18, reviewedBy: "user-1" },
  });
  assert.equal(auditCalls.at(-1)?.action, "assignment.review");
  assert.deepEqual(auditCalls.at(-1)?.metadata, {
    assignmentId: "asgn1",
    classroomId: "c1",
    studentId: "student-1",
    hasFeedback: true,
    scoreAction: "set",
  });
});

test("PATCH assignment completion review rejects an awarded score over max points", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };

  const res = await patchAssignmentCompletionReview("asgn1", "student-1", {
    pointsAwarded: 21,
  });

  assert.equal(res.status, 400);
  assert.equal(reviewAssignmentCompletionCalls.length, 0);
});

test("PATCH assignment completion review rejects awarded score above absolute cap", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: null };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };

  const res = await patchAssignmentCompletionReview("asgn1", "student-1", {
    pointsAwarded: 100001,
  });

  assert.equal(res.status, 400);
  assert.equal(reviewAssignmentCompletionCalls.length, 0);
});

test("PATCH assignment completion review allows unbounded score when assignment points are null", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: null };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };

  const res = await patchAssignmentCompletionReview("asgn1", "student-1", {
    pointsAwarded: 500,
  });

  assert.equal(res.status, 200);
  assert.equal(reviewAssignmentCompletionCalls.at(-1)?.input.pointsAwarded, 500);
});

test("PATCH assignment completion review clears awarded score with null", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };

  const res = await patchAssignmentCompletionReview("asgn1", "student-1", {
    pointsAwarded: null,
  });

  assert.equal(res.status, 200);
  assert.equal(reviewAssignmentCompletionCalls.at(-1)?.input.pointsAwarded, null);
});

// ===========================================================================
// GET /api/assignments/[id]
// ===========================================================================

test("GET /api/assignments/[id] returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await getAssignmentRoute("asgn1");
  assert.equal(res.status, 401);
});

test("GET /api/assignments/[id] returns 404 when assignment is missing", async () => {
  assignmentClassroomResult = null;
  const res = await getAssignmentRoute("missing");
  assert.equal(res.status, 404);
});

test("GET /api/assignments/[id] enforces tenant isolation with classroom-manage guard", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  const res = await getAssignmentRoute("asgn1");
  assert.equal(res.status, 403);
});

test("GET /api/assignments/[id] returns 200 with assignment detail on success", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  assignmentDetailResult = {
    id: "a1",
    classroomId: "c1",
    classroomName: "C1",
    articleId: "art1",
    articleTitle: "T",
    dueDate: null,
    instructions: null,
    completions: [],
  };
  const res = await getAssignmentRoute("asgn1");
  assert.equal(res.status, 200);
  const body = await res.json() as { assignment: { id: string; classroomId: string } };
  assert.equal(body.assignment.id, "a1");
  assert.equal(body.assignment.classroomId, "c1");
});

// ===========================================================================
// POST /api/assignments/[id]/remind
// ===========================================================================

test("POST /api/assignments/[id]/remind returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await remindAssignmentRoute("asgn1");
  assert.equal(res.status, 401);
});

test("POST /api/assignments/[id]/remind returns 404 when assignment is missing", async () => {
  assignmentClassroomResult = null;
  const res = await remindAssignmentRoute("missing");
  assert.equal(res.status, 404);
});

test("POST /api/assignments/[id]/remind enforces tenant isolation with classroom-manage guard", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  const res = await remindAssignmentRoute("asgn1");
  assert.equal(res.status, 403);
});

test("POST /api/assignments/[id]/remind returns 200 with result on success", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  remindResult = { total: 5, notified: 3, skipped: 1, suppressed: 1 };
  const res = await remindAssignmentRoute("asgn1");
  assert.equal(res.status, 200);
  const body = await res.json() as { result: { total: number; notified: number; skipped: number; suppressed: number } };
  assert.deepEqual(body.result, { total: 5, notified: 3, skipped: 1, suppressed: 1 });
  assert.equal(auditCalls.at(-1)?.action, "assignment.remind");
  assert.deepEqual(auditCalls.at(-1)?.metadata, {
    assignmentId: "asgn1",
    classroomId: "c1",
    total: 5,
    notified: 3,
  });
});

// ===========================================================================
// POST /api/assignments/[id]/reopen
// ===========================================================================

test("POST /api/assignments/[id]/reopen returns 200 with result on success", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "user-1" };
  reopenResult = { reopened: 4 };

  const res = await reopenAssignmentRoute("asgn1");

  assert.equal(res.status, 200);
  const body = await res.json() as { result: { reopened: number } };
  assert.deepEqual(body.result, { reopened: 4 });
  assert.deepEqual(reopenAssignmentCalls, ["asgn1"]);
  assert.equal(auditCalls.at(-1)?.action, "assignment.reopen");
  assert.deepEqual(auditCalls.at(-1)?.metadata, {
    assignmentId: "asgn1",
    classroomId: "c1",
    reopened: 4,
  });
});

test("POST /api/assignments/[id]/reopen returns 404 when assignment is missing", async () => {
  assignmentClassroomResult = null;
  const res = await reopenAssignmentRoute("missing");
  assert.equal(res.status, 404);
  assert.equal(reopenAssignmentCalls.length, 0);
});

test("POST /api/assignments/[id]/reopen enforces tenant isolation with classroom-manage guard", async () => {
  assignmentClassroomResult = { id: "asgn1", classroomId: "c1", points: 20 };
  classroomStub = { id: "c1", orgId: "org-1", teacherId: "other-teacher" };
  const res = await reopenAssignmentRoute("asgn1");
  assert.equal(res.status, 403);
  assert.equal(reopenAssignmentCalls.length, 0);
});
