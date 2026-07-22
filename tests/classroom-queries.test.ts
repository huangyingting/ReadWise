/**
 * Unit tests for classroom read queries (classroom/queries.ts).
 *
 * Verifies that each query is correctly user/role/org-scoped and that the
 * returned row shape is properly mapped. All Prisma calls are mocked — no real
 * DB is touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mutable stub state ---------------------------------------------------

let classroomStub: Record<string, unknown> | null = null;
let classroomListStub: Record<string, unknown>[] = [];
let membershipListStub: Record<string, unknown>[] = [];
let assignmentStub: Record<string, unknown> | null = null;
let assignmentListStub: Record<string, unknown>[] = [];
let assignmentCountStub = 0;

let lastClassroomFindManyWhere: unknown = null;
let lastClassroomFindManyOrderBy: unknown = null;
let lastAssignmentCountWhere: unknown = null;
let lastAssignmentFindManyWhere: unknown = null;

type OrgWhere = { orgId: string; archivedAt: null };
type TeacherWhere = { archivedAt: null; OR: Array<{ teacherId?: string; members?: unknown }> };
type ArchivedTeacherWhere = {
  archivedAt: { not: null };
  OR: Array<{ teacherId?: string; members?: unknown }>;
};
type StudentWhere = { archivedAt: null; members: { some: { userId: string } } };

async function classroomQueries() {
  return import("@/lib/classroom/queries");
}

function lastWhere<T>(): T {
  assert.ok(lastClassroomFindManyWhere, "classroom.findMany should have been called");
  return lastClassroomFindManyWhere as T;
}

function lastOrderBy<T>(): T {
  assert.ok(lastClassroomFindManyOrderBy, "classroom.findMany should include orderBy");
  return lastClassroomFindManyOrderBy as T;
}

// ---- mock setup ------------------------------------------------------------

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        classroom: {
          findUnique: async () => classroomStub,
          findMany: async (args: { where?: unknown; orderBy?: unknown }) => {
            lastClassroomFindManyWhere = args?.where;
            lastClassroomFindManyOrderBy = args?.orderBy;
            return classroomListStub;
          },
        },
        classroomMembership: {
          findMany: async () => membershipListStub,
        },
        assignment: {
          findUnique: async () => assignmentStub,
          findMany: async (args: { where?: unknown }) => {
            lastAssignmentFindManyWhere = args?.where;
            return assignmentListStub;
          },
          count: async (args: { where?: unknown }) => {
            lastAssignmentCountWhere = args?.where;
            return assignmentCountStub;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  classroomStub = null;
  classroomListStub = [];
  membershipListStub = [];
  assignmentStub = null;
  assignmentListStub = [];
  assignmentCountStub = 0;
  lastClassroomFindManyWhere = null;
  lastClassroomFindManyOrderBy = null;
  lastAssignmentCountWhere = null;
  lastAssignmentFindManyWhere = null;
});

// ---- getClassroom ----------------------------------------------------------

test("getClassroom returns the classroom when it exists", async () => {
  classroomStub = { id: "c1", name: "Algebra", orgId: "o1", teacherId: "t1" };
  const { getClassroom } = await classroomQueries();
  const result = await getClassroom("c1");
  assert.deepEqual(result, classroomStub);
});

test("getClassroom returns null when the classroom does not exist", async () => {
  classroomStub = null;
  const { getClassroom } = await classroomQueries();
  const result = await getClassroom("missing");
  assert.equal(result, null);
});

test("getAssignmentClassroom returns assignment id and classroomId when it exists", async () => {
  assignmentStub = { id: "a1", classroomId: "c1" };
  const { getAssignmentClassroom } = await classroomQueries();
  const result = await getAssignmentClassroom("a1");
  assert.deepEqual(result, { id: "a1", classroomId: "c1" });
});

test("getAssignmentClassroom returns null when assignment does not exist", async () => {
  assignmentStub = null;
  const { getAssignmentClassroom } = await classroomQueries();
  const result = await getAssignmentClassroom("missing");
  assert.equal(result, null);
});

test("listClassroomAssignmentMeta maps editable assignment metadata", async () => {
  assignmentListStub = [
    {
      id: "a1",
      dueDate: new Date("2026-08-01"),
      instructions: "Read carefully",
      title: "Week 1",
      points: 20,
    },
  ];
  const { listClassroomAssignmentMeta } = await classroomQueries();
  const result = await listClassroomAssignmentMeta("c1");
  assert.deepEqual(result, [
    {
      assignmentId: "a1",
      dueDate: new Date("2026-08-01"),
      instructions: "Read carefully",
      title: "Week 1",
      points: 20,
    },
  ]);
});

// ---- listClassroomsForOrg --------------------------------------------------

test("listClassroomsForOrg returns classrooms scoped to the given org", async () => {
  classroomListStub = [
    { id: "c1", orgId: "o1" },
    { id: "c2", orgId: "o1" },
  ];
  const { listClassroomsForOrg } = await classroomQueries();
  const result = await listClassroomsForOrg("o1");
  assert.equal(result.length, 2);
  const where = lastWhere<OrgWhere>();
  assert.equal(where.orgId, "o1");
  assert.equal(where.archivedAt, null);
});

test("listClassroomsForOrg returns empty array when org has no classrooms", async () => {
  classroomListStub = [];
  const { listClassroomsForOrg } = await classroomQueries();
  const result = await listClassroomsForOrg("empty-org");
  assert.deepEqual(result, []);
});

test("listClassroomsForOrg does not return classrooms belonging to a different org", async () => {
  classroomListStub = [];
  const { listClassroomsForOrg } = await classroomQueries();
  await listClassroomsForOrg("org-a");
  const where = lastWhere<OrgWhere>();
  assert.equal(where.orgId, "org-a");
  assert.equal(where.archivedAt, null);
});

// ---- listClassroomsForTeacher ----------------------------------------------

test("listClassroomsForTeacher includes classrooms where user is the primary teacher", async () => {
  classroomListStub = [{ id: "c1", teacherId: "t1" }];
  const { listClassroomsForTeacher } = await classroomQueries();
  const result = await listClassroomsForTeacher("t1");
  assert.equal(result.length, 1);
  const where = lastWhere<TeacherWhere>();
  assert.equal(where.archivedAt, null);
  assert.ok(where.OR.some((clause) => clause.teacherId === "t1"));
});

test("listClassroomsForTeacher includes classrooms where user is a Teacher member", async () => {
  classroomListStub = [{ id: "c2", teacherId: "other" }];
  const { listClassroomsForTeacher } = await classroomQueries();
  const result = await listClassroomsForTeacher("t2");
  assert.equal(result.length, 1);
  const where = lastWhere<TeacherWhere>();
  assert.equal(where.archivedAt, null);
  assert.ok(where.OR.some((clause) => clause.members !== undefined));
});

test("listClassroomsForTeacher query uses an OR condition for primary teacher and Teacher membership", async () => {
  classroomListStub = [];
  const { listClassroomsForTeacher } = await classroomQueries();
  await listClassroomsForTeacher("t1");
  const where = lastWhere<{ OR: unknown[] }>();
  assert.ok(Array.isArray(where.OR));
  assert.equal(where.OR.length, 2);
});

test("listClassroomsForTeacher returns empty array when teacher has no classrooms", async () => {
  classroomListStub = [];
  const { listClassroomsForTeacher } = await classroomQueries();
  const result = await listClassroomsForTeacher("no-classes");
  assert.deepEqual(result, []);
});

test("listArchivedClassroomsForTeacher scopes to archived classrooms for the teacher, newest first", async () => {
  classroomListStub = [
    { id: "archived-new", teacherId: "t1", archivedAt: new Date("2026-07-21T04:00:00.000Z") },
    { id: "archived-old", teacherId: "t1", archivedAt: new Date("2026-07-21T03:00:00.000Z") },
  ];
  const { listArchivedClassroomsForTeacher } = await classroomQueries();
  const result = await listArchivedClassroomsForTeacher("t1");
  assert.deepEqual(result.map((classroom) => classroom.id), ["archived-new", "archived-old"]);

  const where = lastWhere<ArchivedTeacherWhere>();
  assert.deepEqual(where.archivedAt, { not: null });
  assert.ok(where.OR.some((clause) => clause.teacherId === "t1"));
  assert.ok(where.OR.some((clause) => clause.members !== undefined));
  assert.deepEqual(lastOrderBy<{ createdAt: "desc" }>(), { createdAt: "desc" });
});

// ---- listClassroomsForStudent ----------------------------------------------

test("listClassroomsForStudent returns classrooms the student is enrolled in", async () => {
  classroomListStub = [{ id: "c1" }, { id: "c3" }];
  const { listClassroomsForStudent } = await classroomQueries();
  const result = await listClassroomsForStudent("s1");
  assert.equal(result.length, 2);
});

test("listClassroomsForStudent filters by the student's userId", async () => {
  classroomListStub = [];
  const { listClassroomsForStudent } = await classroomQueries();
  await listClassroomsForStudent("s1");
  const where = lastWhere<StudentWhere>();
  assert.equal(where.members.some.userId, "s1");
  assert.equal(where.archivedAt, null);
});

test("listClassroomsForStudent uses a different userId scope per call", async () => {
  classroomListStub = [];
  const { listClassroomsForStudent } = await classroomQueries();
  await listClassroomsForStudent("student-99");
  const where = lastWhere<StudentWhere>();
  assert.equal(where.members.some.userId, "student-99");
});

test("listClassroomsForStudent returns empty array when student is not enrolled anywhere", async () => {
  classroomListStub = [];
  const { listClassroomsForStudent } = await classroomQueries();
  const result = await listClassroomsForStudent("unenrolled");
  assert.deepEqual(result, []);
});

// ---- listClassroomMembers --------------------------------------------------

test("listClassroomMembers maps rows to ClassroomMemberRow shape", async () => {
  membershipListStub = [
    {
      userId: "t1",
      role: "Teacher",
      createdAt: new Date(),
      user: { id: "t1", name: "Alice", email: "alice@e.com", image: "img.png" },
    },
    {
      userId: "s1",
      role: "Student",
      createdAt: new Date(),
      user: { id: "s1", name: "Bob", email: "bob@e.com", image: null },
    },
  ];
  const { listClassroomMembers } = await classroomQueries();
  const result = await listClassroomMembers("c1");
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    userId: "t1",
    role: "Teacher",
    name: "Alice",
    email: "alice@e.com",
    image: "img.png",
  });
  assert.deepEqual(result[1], {
    userId: "s1",
    role: "Student",
    name: "Bob",
    email: "bob@e.com",
    image: null,
  });
});

test("listClassroomMembers returns empty array for a classroom with no members", async () => {
  membershipListStub = [];
  const { listClassroomMembers } = await classroomQueries();
  const result = await listClassroomMembers("empty-c");
  assert.deepEqual(result, []);
});

test("listClassroomMembers handles null name, email, and image gracefully", async () => {
  membershipListStub = [
    {
      userId: "s2",
      role: "Student",
      createdAt: new Date(),
      user: { id: "s2", name: null, email: null, image: null },
    },
  ];
  const { listClassroomMembers } = await classroomQueries();
  const result = await listClassroomMembers("c2");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    userId: "s2",
    role: "Student",
    name: null,
    email: null,
    image: null,
  });
});

test("listClassroomMembers preserves all rows without filtering", async () => {
  membershipListStub = [
    { userId: "t1", role: "Teacher", createdAt: new Date(), user: { id: "t1", name: "T", email: "t@e.com", image: null } },
    { userId: "s1", role: "Student", createdAt: new Date(), user: { id: "s1", name: "S1", email: "s1@e.com", image: null } },
    { userId: "s2", role: "Student", createdAt: new Date(), user: { id: "s2", name: "S2", email: "s2@e.com", image: null } },
  ];
  const { listClassroomMembers } = await classroomQueries();
  const result = await listClassroomMembers("c1");
  assert.equal(result.length, 3);
  assert.equal(result[0].userId, "t1");
  assert.equal(result[1].userId, "s1");
  assert.equal(result[2].userId, "s2");
});

// ---- countPendingAssignmentsForStudent -------------------------------------

type PendingCountWhere = {
  classroom: { archivedAt: null; members: { some: { userId: string } } };
  NOT: { completions: { some: { studentId: string; status: string } } };
};

test("countPendingAssignmentsForStudent returns the prisma.assignment.count result", async () => {
  assignmentCountStub = 3;
  const { countPendingAssignmentsForStudent } = await classroomQueries();
  const result = await countPendingAssignmentsForStudent("s1");
  assert.equal(result, 3);
});

test("countPendingAssignmentsForStudent passes classroom archivedAt:null and member userId filter", async () => {
  assignmentCountStub = 1;
  const { countPendingAssignmentsForStudent } = await classroomQueries();
  await countPendingAssignmentsForStudent("student-42");
  assert.ok(lastAssignmentCountWhere, "assignment.count should have been called");
  const where = lastAssignmentCountWhere as PendingCountWhere;
  assert.equal(where.classroom.archivedAt, null, "must exclude archived classrooms");
  assert.equal(where.classroom.members.some.userId, "student-42", "must scope to the student");
});

test("countPendingAssignmentsForStudent uses NOT completions COMPLETED filter", async () => {
  assignmentCountStub = 2;
  const { countPendingAssignmentsForStudent } = await classroomQueries();
  await countPendingAssignmentsForStudent("student-99");
  const where = lastAssignmentCountWhere as PendingCountWhere;
  assert.equal(where.NOT.completions.some.studentId, "student-99", "completions filter must use same studentId");
  assert.equal(where.NOT.completions.some.status, "COMPLETED", "completions filter must exclude COMPLETED status");
});

test("countPendingAssignmentsForStudent returns 0 when no pending assignments", async () => {
  assignmentCountStub = 0;
  const { countPendingAssignmentsForStudent } = await classroomQueries();
  const result = await countPendingAssignmentsForStudent("all-done-student");
  assert.equal(result, 0);
});

// ---- listAssignmentsForTeacher --------------------------------------------

type AssignmentFindManyWhere = {
  classroom: {
    archivedAt: null;
    OR: Array<{ teacherId?: string; members?: unknown }>;
  };
};

test("listAssignmentsForTeacher returns mapped rows with correct completedCount and studentCount", async () => {
  assignmentListStub = [
    {
      id: "a1",
      dueDate: new Date("2026-08-01"),
      title: "Week 1",
      points: 20,
      classroom: {
        id: "c1",
        name: "Algebra",
        members: [{ userId: "s1" }, { userId: "s2" }],
      },
      article: { id: "art1", title: "Article One" },
      completions: [{ studentId: "s1" }],
    },
    {
      id: "a2",
      dueDate: null,
      title: null,
      points: null,
      classroom: {
        id: "c2",
        name: "Biology",
        members: [{ userId: "s3" }],
      },
      article: { id: "art2", title: "Article Two" },
      completions: [],
    },
  ];
  const { listAssignmentsForTeacher } = await classroomQueries();
  const result = await listAssignmentsForTeacher("t1");
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    assignmentId: "a1",
    classroomId: "c1",
    classroomName: "Algebra",
    articleId: "art1",
    articleTitle: "Article One",
    title: "Week 1",
    points: 20,
    dueDate: new Date("2026-08-01"),
    completedCount: 1,
    studentCount: 2,
  });
  assert.deepEqual(result[1], {
    assignmentId: "a2",
    classroomId: "c2",
    classroomName: "Biology",
    articleId: "art2",
    articleTitle: "Article Two",
    title: null,
    points: null,
    dueDate: null,
    completedCount: 0,
    studentCount: 1,
  });
});

test("listAssignmentsForTeacher sorts soonest-due first, undated last", async () => {
  assignmentListStub = [
    {
      id: "a-null",
      dueDate: null,
      title: null,
      points: null,
      classroom: { id: "c1", name: "C1", members: [] },
      article: { id: "art1", title: "T1" },
      completions: [],
    },
    {
      id: "a-far",
      dueDate: new Date("2026-09-01"),
      title: null,
      points: null,
      classroom: { id: "c1", name: "C1", members: [] },
      article: { id: "art2", title: "T2" },
      completions: [],
    },
    {
      id: "a-near",
      dueDate: new Date("2026-07-25"),
      title: null,
      points: null,
      classroom: { id: "c1", name: "C1", members: [] },
      article: { id: "art3", title: "T3" },
      completions: [],
    },
  ];
  const { listAssignmentsForTeacher } = await classroomQueries();
  const result = await listAssignmentsForTeacher("t1");
  assert.deepEqual(
    result.map((r) => r.assignmentId),
    ["a-near", "a-far", "a-null"],
  );
});

test("listAssignmentsForTeacher where includes classroom.archivedAt:null and teacher OR filter", async () => {
  assignmentListStub = [];
  const { listAssignmentsForTeacher } = await classroomQueries();
  await listAssignmentsForTeacher("t42");
  assert.ok(lastAssignmentFindManyWhere, "assignment.findMany should have been called");
  const where = lastAssignmentFindManyWhere as AssignmentFindManyWhere;
  assert.equal(where.classroom.archivedAt, null);
  assert.ok(Array.isArray(where.classroom.OR));
  assert.equal(where.classroom.OR.length, 2);
  assert.ok(where.classroom.OR.some((c) => c.teacherId === "t42"));
  assert.ok(where.classroom.OR.some((c) => c.members !== undefined));
});

// ---- getAssignmentDetail --------------------------------------------------

test("getAssignmentDetail returns null when assignment does not exist", async () => {
  assignmentStub = null;
  const { getAssignmentDetail } = await classroomQueries();
  const result = await getAssignmentDetail("missing");
  assert.equal(result, null);
});

test("getAssignmentDetail maps assignment and completions including feedback, reviewedAt, student name/email", async () => {
  assignmentStub = {
    id: "a1",
    classroomId: "c1",
    dueDate: new Date("2026-08-10"),
    instructions: "Read carefully",
    title: "Lab prep",
    points: 15,
    classroom: { name: "Physics" },
    article: { id: "art1", title: "Newton's Laws" },
    completions: [
      {
        studentId: "s1",
        status: "COMPLETED",
        quizScore: 90,
        completionSource: "SELF",
        completedAt: new Date("2026-07-20"),
        feedback: "Excellent",
        reviewedAt: new Date("2026-07-21"),
        student: { name: "Alice", email: "alice@example.com" },
      },
      {
        studentId: "s2",
        status: "ASSIGNED",
        quizScore: null,
        completionSource: null,
        completedAt: null,
        feedback: null,
        reviewedAt: null,
        student: { name: null, email: null },
      },
    ],
  };
  const { getAssignmentDetail } = await classroomQueries();
  const result = await getAssignmentDetail("a1");
  assert.ok(result);
  assert.equal(result.id, "a1");
  assert.equal(result.classroomId, "c1");
  assert.equal(result.classroomName, "Physics");
  assert.equal(result.articleId, "art1");
  assert.equal(result.articleTitle, "Newton's Laws");
  assert.deepEqual(result.dueDate, new Date("2026-08-10"));
  assert.equal(result.instructions, "Read carefully");
  assert.equal(result.title, "Lab prep");
  assert.equal(result.points, 15);
  assert.equal(result.completions.length, 2);
  assert.deepEqual(result.completions[0], {
    studentId: "s1",
    name: "Alice",
    email: "alice@example.com",
    status: "COMPLETED",
    quizScore: 90,
    completionSource: "SELF",
    completedAt: new Date("2026-07-20"),
    feedback: "Excellent",
    reviewedAt: new Date("2026-07-21"),
  });
  assert.deepEqual(result.completions[1], {
    studentId: "s2",
    name: null,
    email: null,
    status: "ASSIGNED",
    quizScore: null,
    completionSource: null,
    completedAt: null,
    feedback: null,
    reviewedAt: null,
  });
});
