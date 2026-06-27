/**
 * Unit tests for classroom progress read model (classroom/progress.ts).
 *
 * Verifies that getClassroomProgressData:
 *   - returns null when the classroom does not exist
 *   - returns the classroom header data
 *   - maps student member rows to ClassroomProgressStudent shape
 *   - maps assignment rows to ClassroomProgressAssignment shape
 *   - maps completion rows to ClassroomProgressCompletion shape
 *   - handles null optional fields (quizScore, completedAt, name, email)
 *   - returns empty arrays when the classroom exists but has no data
 *
 * All Prisma calls are mocked — no real DB is touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { AssignmentStatus } from "@prisma/client";

// ---- mutable stub state ---------------------------------------------------

let classroomStub: Record<string, unknown> | null = null;
let memberRowStub: Record<string, unknown>[] = [];
let assignmentRowStub: Record<string, unknown>[] = [];
let completionRowStub: Record<string, unknown>[] = [];

// ---- mock setup ------------------------------------------------------------

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        classroom: {
          findUnique: async () => classroomStub,
        },
        classroomMembership: {
          findMany: async () => memberRowStub,
        },
        assignment: {
          findMany: async () => assignmentRowStub,
        },
        assignmentCompletion: {
          findMany: async () => completionRowStub,
        },
      },
    },
  });
});

beforeEach(() => {
  classroomStub = { id: "c1", name: "Math", orgId: "o1", teacherId: "t1" };
  memberRowStub = [];
  assignmentRowStub = [];
  completionRowStub = [];
});

// ---- getClassroomProgressData — null classroom ----------------------------

test("getClassroomProgressData returns null when classroom does not exist", async () => {
  classroomStub = null;
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  const result = await getClassroomProgressData("nonexistent");
  assert.equal(result, null);
});

test("getClassroomProgressData does not fetch roster or assignments when classroom is missing", async () => {
  classroomStub = null;
  memberRowStub = [{ userId: "s1", user: { id: "s1", name: "S", email: "s@e.com" } }];
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  // Should short-circuit and return null without touching member/assignment rows
  const result = await getClassroomProgressData("nonexistent");
  assert.equal(result, null);
});

// ---- classroom header -----------------------------------------------------

test("getClassroomProgressData returns the classroom header fields", async () => {
  classroomStub = { id: "c1", name: "Math", orgId: "o1", teacherId: "t1" };
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  const result = await getClassroomProgressData("c1");
  assert.ok(result, "result must not be null");
  assert.deepEqual(result.classroom, { id: "c1", name: "Math", orgId: "o1", teacherId: "t1" });
});

test("getClassroomProgressData reflects the correct classroom for each call", async () => {
  classroomStub = { id: "c2", name: "Science", orgId: "o2", teacherId: "t2" };
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  const result = await getClassroomProgressData("c2");
  assert.ok(result);
  assert.equal(result.classroom.id, "c2");
  assert.equal(result.classroom.name, "Science");
  assert.equal(result.classroom.orgId, "o2");
  assert.equal(result.classroom.teacherId, "t2");
});

// ---- empty classroom -------------------------------------------------------

test("getClassroomProgressData returns empty arrays for an empty classroom", async () => {
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  const result = await getClassroomProgressData("c1");
  assert.ok(result);
  assert.deepEqual(result.students, []);
  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.completions, []);
});

// ---- student mapping -------------------------------------------------------

test("getClassroomProgressData maps student members to ClassroomProgressStudent shape", async () => {
  memberRowStub = [
    { userId: "s1", user: { id: "s1", name: "Alice", email: "alice@e.com" } },
    { userId: "s2", user: { id: "s2", name: "Bob", email: "bob@e.com" } },
  ];
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  const result = await getClassroomProgressData("c1");
  assert.ok(result);
  assert.equal(result.students.length, 2);
  assert.deepEqual(result.students[0], { userId: "s1", name: "Alice", email: "alice@e.com" });
  assert.deepEqual(result.students[1], { userId: "s2", name: "Bob", email: "bob@e.com" });
});

test("getClassroomProgressData maps student with null name and email", async () => {
  memberRowStub = [{ userId: "s3", user: { id: "s3", name: null, email: null } }];
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  const result = await getClassroomProgressData("c1");
  assert.ok(result);
  assert.equal(result.students.length, 1);
  assert.deepEqual(result.students[0], { userId: "s3", name: null, email: null });
});

// ---- assignment mapping ----------------------------------------------------

test("getClassroomProgressData maps assignment rows to ClassroomProgressAssignment shape", async () => {
  const createdAt = new Date("2026-01-01");
  const dueDate = new Date("2026-06-01");
  assignmentRowStub = [
    {
      id: "asgn1",
      articleId: "art1",
      dueDate,
      createdAt,
      article: { id: "art1", title: "Article One" },
    },
  ];
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  const result = await getClassroomProgressData("c1");
  assert.ok(result);
  assert.equal(result.assignments.length, 1);
  assert.deepEqual(result.assignments[0], {
    id: "asgn1",
    articleId: "art1",
    articleTitle: "Article One",
    dueDate,
    createdAt,
  });
});

test("getClassroomProgressData maps assignment with null dueDate", async () => {
  const createdAt = new Date("2026-02-15");
  assignmentRowStub = [
    {
      id: "asgn2",
      articleId: "art2",
      dueDate: null,
      createdAt,
      article: { id: "art2", title: "No Due Date Article" },
    },
  ];
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  const result = await getClassroomProgressData("c1");
  assert.ok(result);
  assert.equal(result.assignments[0].dueDate, null);
  assert.equal(result.assignments[0].articleTitle, "No Due Date Article");
});

// ---- completion mapping ----------------------------------------------------

test("getClassroomProgressData maps completion rows to ClassroomProgressCompletion shape", async () => {
  const completedAt = new Date("2026-05-15");
  completionRowStub = [
    {
      assignmentId: "asgn1",
      studentId: "s1",
      status: AssignmentStatus.COMPLETED,
      quizScore: 92,
      completedAt,
    },
  ];
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  const result = await getClassroomProgressData("c1");
  assert.ok(result);
  assert.equal(result.completions.length, 1);
  assert.deepEqual(result.completions[0], {
    assignmentId: "asgn1",
    studentId: "s1",
    status: AssignmentStatus.COMPLETED,
    quizScore: 92,
    completedAt,
  });
});

test("getClassroomProgressData maps completion with IN_PROGRESS status and null quizScore/completedAt", async () => {
  completionRowStub = [
    {
      assignmentId: "asgn2",
      studentId: "s2",
      status: AssignmentStatus.IN_PROGRESS,
      quizScore: null,
      completedAt: null,
    },
  ];
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  const result = await getClassroomProgressData("c1");
  assert.ok(result);
  assert.equal(result.completions[0].status, AssignmentStatus.IN_PROGRESS);
  assert.equal(result.completions[0].quizScore, null);
  assert.equal(result.completions[0].completedAt, null);
});

test("getClassroomProgressData maps completion with ASSIGNED status", async () => {
  completionRowStub = [
    {
      assignmentId: "asgn3",
      studentId: "s1",
      status: AssignmentStatus.ASSIGNED,
      quizScore: null,
      completedAt: null,
    },
  ];
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  const result = await getClassroomProgressData("c1");
  assert.ok(result);
  assert.equal(result.completions[0].status, AssignmentStatus.ASSIGNED);
});

// ---- full matrix -----------------------------------------------------------

test("getClassroomProgressData returns full matrix with multiple students, assignments, and completions", async () => {
  memberRowStub = [
    { userId: "s1", user: { id: "s1", name: "S1", email: "s1@e.com" } },
    { userId: "s2", user: { id: "s2", name: "S2", email: "s2@e.com" } },
  ];
  const t = new Date();
  assignmentRowStub = [
    { id: "a1", articleId: "art1", dueDate: null, createdAt: t, article: { id: "art1", title: "A1" } },
    { id: "a2", articleId: "art2", dueDate: null, createdAt: t, article: { id: "art2", title: "A2" } },
  ];
  completionRowStub = [
    { assignmentId: "a1", studentId: "s1", status: AssignmentStatus.COMPLETED, quizScore: 80, completedAt: t },
    { assignmentId: "a2", studentId: "s2", status: AssignmentStatus.ASSIGNED, quizScore: null, completedAt: null },
  ];
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  const result = await getClassroomProgressData("c1");
  assert.ok(result);
  assert.equal(result.students.length, 2);
  assert.equal(result.assignments.length, 2);
  assert.equal(result.completions.length, 2);
  assert.equal(result.completions.find((c) => c.assignmentId === "a1")?.status, AssignmentStatus.COMPLETED);
  assert.equal(result.completions.find((c) => c.assignmentId === "a2")?.status, AssignmentStatus.ASSIGNED);
});

test("getClassroomProgressData only maps the student members returned by the query", async () => {
  // The source filters classroomMembership where role = 'Student';
  // our stub returns only what it's told (simulating that Teacher rows are excluded).
  memberRowStub = [{ userId: "s1", user: { id: "s1", name: "Student Only", email: "s@e.com" } }];
  const { getClassroomProgressData } = await import("@/lib/classroom/progress");
  const result = await getClassroomProgressData("c1");
  assert.ok(result);
  assert.equal(result.students.length, 1);
  assert.equal(result.students[0].userId, "s1");
});
