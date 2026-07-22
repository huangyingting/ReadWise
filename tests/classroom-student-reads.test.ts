/**
 * Unit tests for student-facing assignment read queries (classroom/student-reads.ts).
 *
 * Verifies that listAssignmentsForStudent:
 *   - scopes assignments to the student's own classrooms
 *   - only includes the requesting student's completion (no peer data)
 *   - defaults status to ASSIGNED when no completion exists
 *   - maps all fields from the Prisma row correctly
 *   - sorts by dueDate ascending (soonest first), undated assignments last
 *
 * All Prisma calls are mocked — no real DB is touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { AssignmentStatus } from "@prisma/client";

// ---- mutable stub state ---------------------------------------------------

let assignmentRowStub: Record<string, unknown>[] = [];
let lastFindManyArgs: unknown = null;

type StudentScopeFindManyArgs = {
  where: {
    classroom: { archivedAt: null; members: { some: { userId: string } } };
    OR: Array<{ targets: { none?: Record<string, never>; some?: { studentId: string } } }>;
  };
};

type CompletionIncludeFindManyArgs = {
  include: { completions: { where: { studentId: string }; take: number } };
};

// ---- mock setup ------------------------------------------------------------

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        assignment: {
          findMany: async (args: unknown) => {
            lastFindManyArgs = args;
            return assignmentRowStub;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  assignmentRowStub = [];
  lastFindManyArgs = null;
});

// ---- helper ----------------------------------------------------------------

function makeRow(overrides: {
  id?: string;
  classroomId?: string;
  classroomName?: string;
  articleId?: string;
  articleTitle?: string;
  title?: string | null;
  points?: number | null;
  pointsAwarded?: number | null;
  dueDate?: Date | null;
  instructions?: string | null;
  completionStatus?: AssignmentStatus;
  quizScore?: number | null;
  completedAt?: Date | null;
} = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? "a1",
    title: overrides.title ?? null,
    points: overrides.points ?? null,
    dueDate: overrides.dueDate ?? null,
    instructions: overrides.instructions ?? null,
    classroom: {
      id: overrides.classroomId ?? "c1",
      name: overrides.classroomName ?? "Math",
    },
    article: {
      id: overrides.articleId ?? "art1",
      title: overrides.articleTitle ?? "Article One",
    },
    completions:
      overrides.completionStatus !== undefined
        ? [
            {
              status: overrides.completionStatus,
              quizScore: overrides.quizScore ?? null,
              pointsAwarded: overrides.pointsAwarded ?? null,
              completedAt: overrides.completedAt ?? null,
            },
          ]
        : [],
  };
}

async function studentReads() {
  return import("@/lib/classroom/student-reads");
}

function lastStudentScopeArgs(): StudentScopeFindManyArgs {
  assert.ok(lastFindManyArgs, "assignment.findMany should have been called");
  return lastFindManyArgs as StudentScopeFindManyArgs;
}

// ---- listAssignmentsForStudent ---------------------------------------------

test("listAssignmentsForStudent returns empty array when student has no assignments", async () => {
  assignmentRowStub = [];
  const { listAssignmentsForStudent } = await studentReads();
  const result = await listAssignmentsForStudent("s1");
  assert.deepEqual(result, []);
});

test("listAssignmentsForStudent scopes assignments to the student's classroom memberships", async () => {
  assignmentRowStub = [makeRow()];
  const { listAssignmentsForStudent } = await studentReads();
  await listAssignmentsForStudent("s1");
  const args = lastStudentScopeArgs();
  assert.equal(args.where.classroom.members.some.userId, "s1");
  assert.equal(args.where.classroom.archivedAt, null);
});

test("listAssignmentsForStudent includes the targeting visibility seam", async () => {
  assignmentRowStub = [makeRow()];
  const { listAssignmentsForStudent } = await studentReads();
  await listAssignmentsForStudent("s1");
  const args = lastStudentScopeArgs();
  assert.deepEqual(args.where.OR, [
    { targets: { none: {} } },
    { targets: { some: { studentId: "s1" } } },
  ]);
});

test("listAssignmentsForStudent uses a different userId scope per call", async () => {
  assignmentRowStub = [];
  const { listAssignmentsForStudent } = await studentReads();
  await listAssignmentsForStudent("student-99");
  const args = lastStudentScopeArgs();
  assert.equal(args.where.classroom.members.some.userId, "student-99");
});

test("listAssignmentsForStudent only includes the requesting student's completion data", async () => {
  assignmentRowStub = [makeRow()];
  const { listAssignmentsForStudent } = await studentReads();
  await listAssignmentsForStudent("s1");
  const args = lastFindManyArgs as CompletionIncludeFindManyArgs;
  assert.equal(args.include.completions.where.studentId, "s1");
  assert.equal(args.include.completions.take, 1);
});

test("listAssignmentsForStudent defaults status to ASSIGNED when no completion exists", async () => {
  assignmentRowStub = [makeRow()]; // no completions
  const { listAssignmentsForStudent } = await studentReads();
  const result = await listAssignmentsForStudent("s1");
  assert.equal(result[0].status, AssignmentStatus.ASSIGNED);
  assert.equal(result[0].quizScore, null);
  assert.equal(result[0].completedAt, null);
  assert.equal(result[0].pointsAwarded, null);
});

test("listAssignmentsForStudent uses the IN_PROGRESS completion status when present", async () => {
  assignmentRowStub = [makeRow({ completionStatus: AssignmentStatus.IN_PROGRESS })];
  const { listAssignmentsForStudent } = await studentReads();
  const result = await listAssignmentsForStudent("s1");
  assert.equal(result[0].status, AssignmentStatus.IN_PROGRESS);
});

test("listAssignmentsForStudent returns COMPLETED status with quizScore and completedAt", async () => {
  const completedAt = new Date("2026-05-01");
  assignmentRowStub = [
    makeRow({
      completionStatus: AssignmentStatus.COMPLETED,
      quizScore: 87,
      completedAt,
    }),
  ];
  const { listAssignmentsForStudent } = await studentReads();
  const result = await listAssignmentsForStudent("s1");
  assert.equal(result[0].status, AssignmentStatus.COMPLETED);
  assert.equal(result[0].quizScore, 87);
  assert.deepEqual(result[0].completedAt, completedAt);
});

test("listAssignmentsForStudent maps all output fields from the Prisma row", async () => {
  const dueDate = new Date("2026-12-01");
  assignmentRowStub = [
    makeRow({
      id: "asgn-99",
      classroomId: "c9",
      classroomName: "History",
      articleId: "art-x",
      articleTitle: "Ancient Rome",
      dueDate,
      instructions: "Take notes",
      title: "Week 1 Display",
      points: 20,
      pointsAwarded: 18,
      completionStatus: AssignmentStatus.ASSIGNED,
    }),
  ];
  const { listAssignmentsForStudent } = await studentReads();
  const result = await listAssignmentsForStudent("s1");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    assignmentId: "asgn-99",
    classroomId: "c9",
    classroomName: "History",
    articleId: "art-x",
    articleTitle: "Ancient Rome",
    title: "Week 1 Display",
    points: 20,
    pointsAwarded: 18,
    dueDate,
    instructions: "Take notes",
    feedback: null,
    status: AssignmentStatus.ASSIGNED,
    quizScore: null,
    completedAt: null,
  });
});

test("listAssignmentsForStudent sorts by dueDate ascending (soonest first)", async () => {
  const soon = new Date("2026-08-01");
  const later = new Date("2026-12-01");
  assignmentRowStub = [
    makeRow({ id: "a-later", dueDate: later }),
    makeRow({ id: "a-soon", dueDate: soon }),
  ];
  const { listAssignmentsForStudent } = await studentReads();
  const result = await listAssignmentsForStudent("s1");
  assert.equal(result[0].assignmentId, "a-soon");
  assert.equal(result[1].assignmentId, "a-later");
});

test("listAssignmentsForStudent places undated assignments after all dated ones", async () => {
  const soon = new Date("2026-08-01");
  assignmentRowStub = [
    makeRow({ id: "no-date", dueDate: null }),
    makeRow({ id: "dated", dueDate: soon }),
  ];
  const { listAssignmentsForStudent } = await studentReads();
  const result = await listAssignmentsForStudent("s1");
  assert.equal(result[0].assignmentId, "dated");
  assert.equal(result[1].assignmentId, "no-date");
});

test("listAssignmentsForStudent places multiple undated assignments all after dated ones", async () => {
  const soon = new Date("2026-09-01");
  assignmentRowStub = [
    makeRow({ id: "no-date-1", dueDate: null }),
    makeRow({ id: "dated", dueDate: soon }),
    makeRow({ id: "no-date-2", dueDate: null }),
  ];
  const { listAssignmentsForStudent } = await studentReads();
  const result = await listAssignmentsForStudent("s1");
  assert.equal(result[0].assignmentId, "dated");
  assert.ok(
    ["no-date-1", "no-date-2"].includes(result[1].assignmentId),
    "second result must be undated",
  );
  assert.ok(
    ["no-date-1", "no-date-2"].includes(result[2].assignmentId),
    "third result must be undated",
  );
});

test("listAssignmentsForStudent sorts correctly when all assignments are undated", async () => {
  assignmentRowStub = [
    makeRow({ id: "u1", dueDate: null }),
    makeRow({ id: "u2", dueDate: null }),
  ];
  const { listAssignmentsForStudent } = await studentReads();
  const result = await listAssignmentsForStudent("s1");
  // Both undated — relative order is stable (all at Infinity)
  assert.equal(result.length, 2);
  assert.ok(["u1", "u2"].includes(result[0].assignmentId));
  assert.ok(["u1", "u2"].includes(result[1].assignmentId));
});

test("listAssignmentsForStudent returns multiple rows each with correct fields", async () => {
  assignmentRowStub = [
    makeRow({ id: "a1", completionStatus: AssignmentStatus.COMPLETED, quizScore: 95 }),
    makeRow({ id: "a2" }), // no completion → ASSIGNED
  ];
  const { listAssignmentsForStudent } = await studentReads();
  const result = await listAssignmentsForStudent("s1");
  assert.equal(result.length, 2);
  const r1 = result.find((r) => r.assignmentId === "a1");
  const r2 = result.find((r) => r.assignmentId === "a2");
  assert.ok(r1);
  assert.ok(r2);
  assert.equal(r1.status, AssignmentStatus.COMPLETED);
  assert.equal(r1.quizScore, 95);
  assert.equal(r2.status, AssignmentStatus.ASSIGNED);
  assert.equal(r2.quizScore, null);
});

test("listStudentAssignmentsForArticle includes article, classroom, and targeting filters", async () => {
  assignmentRowStub = [makeRow({ articleId: "art-42" })];
  const { listStudentAssignmentsForArticle } = await studentReads();
  await listStudentAssignmentsForArticle("s42", "art-42");
  const args = lastFindManyArgs as StudentScopeFindManyArgs & { where: { articleId: string } };
  assert.equal(args.where.articleId, "art-42");
  assert.equal(args.where.classroom.members.some.userId, "s42");
  assert.deepEqual(args.where.OR, [
    { targets: { none: {} } },
    { targets: { some: { studentId: "s42" } } },
  ]);
});
