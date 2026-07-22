/**
 * Unit tests for markAssignmentQuizComplete (classroom/completions.ts).
 *
 * A graded quiz attempt completes every active assignment of that article in a
 * classroom the student is ENROLLED in. Verifies enrollment scoping (the where
 * clause never trusts a client studentId), 0–100 score clamping, multi-classroom
 * fan-out, and idempotent re-attempts (upsert update path).
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { AssignmentCompletionSource } from "@prisma/client";

let findManyArgs: unknown = null;
let findManyResult: Array<{ id: string }> = [];
let findFirstArgs: unknown = null;
let findFirstResult: {
  id: string;
  classroomId: string;
  classroom: { archivedAt: Date | null };
} | null = null;
const upsertCalls: Array<Record<string, unknown>> = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        assignment: {
          findFirst: async (args: unknown) => {
            findFirstArgs = args;
            return findFirstResult;
          },
          findMany: async (args: unknown) => {
            findManyArgs = args;
            return findManyResult;
          },
        },
        assignmentCompletion: {
          upsert: async (args: Record<string, unknown>) => {
            upsertCalls.push(args);
            return args;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  findManyArgs = null;
  findManyResult = [];
  findFirstArgs = null;
  findFirstResult = null;
  upsertCalls.length = 0;
});

async function load(): Promise<typeof import("@/lib/classroom/completions")> {
  return import("@/lib/classroom/completions");
}

test("student assignment context exposes archived classroom state for route rejection", async () => {
  const archivedAt = new Date("2026-07-21T03:00:00.000Z");
  findFirstResult = {
    id: "asgn-archived",
    classroomId: "class-archived",
    classroom: { archivedAt },
  };
  const { getStudentAssignmentContext } = await load();
  const result = await getStudentAssignmentContext("asgn-archived", "student-1");
  const args = findFirstArgs as {
    where: {
      id: string;
      classroom: { members: { some: { userId: string } } };
      AND: Array<{ OR: unknown[] }>;
    };
    select: { classroom: { select: { archivedAt: boolean } } };
  };
  assert.equal(args.where.id, "asgn-archived");
  assert.deepEqual(args.where.classroom.members.some, { userId: "student-1" });
  assert.deepEqual(args.where.AND[0].OR, [
    { targets: { none: {} } },
    { targets: { some: { studentId: "student-1" } } },
  ]);
  assert.deepEqual(args.where.AND[1].OR[0], { publishState: "PUBLISHED" });
  assert.equal(args.select.classroom.select.archivedAt, true);
  assert.deepEqual(result, {
    assignmentId: "asgn-archived",
    classroomId: "class-archived",
    classroomArchivedAt: archivedAt,
  });
});

test("scopes the assignment lookup to classrooms the student is enrolled in", async () => {
  findManyResult = [{ id: "asgn-1" }];
  const { markAssignmentQuizComplete } = await load();
  await markAssignmentQuizComplete({ userId: "student-1", articleId: "article-1", scorePct: 80 });
  const args = findManyArgs as {
    where: {
      articleId: string;
      classroom: { archivedAt: null; members: { some: { userId: string } } };
      AND: Array<{ OR: unknown[] }>;
    };
  };
  assert.equal(args.where.articleId, "article-1");
  assert.equal(args.where.classroom.archivedAt, null);
  assert.deepEqual(args.where.classroom.members.some, { userId: "student-1" });
  assert.deepEqual(args.where.AND[0].OR, [
    { targets: { none: {} } },
    { targets: { some: { studentId: "student-1" } } },
  ]);
  assert.deepEqual(args.where.AND[1].OR[0], { publishState: "PUBLISHED" });
});

test("non-targeted student context returns null when the visibility seam excludes it", async () => {
  findFirstResult = null;
  const { getStudentAssignmentContext } = await load();
  const result = await getStudentAssignmentContext("asgn-targeted", "student-2");
  assert.equal(result, null);
  const args = findFirstArgs as {
    where: {
      AND: Array<{ OR: unknown[] }>;
    };
  };
  assert.deepEqual(args.where.AND[0].OR, [
    { targets: { none: {} } },
    { targets: { some: { studentId: "student-2" } } },
  ]);
  assert.deepEqual(args.where.AND[1].OR[0], { publishState: "PUBLISHED" });
});

test("does nothing when the student is not enrolled in any classroom for the article", async () => {
  findManyResult = [];
  const { markAssignmentQuizComplete } = await load();
  const result = await markAssignmentQuizComplete({
    userId: "outsider",
    articleId: "article-1",
    scorePct: 100,
  });
  assert.deepEqual(result, { completedCount: 0 });
  assert.equal(upsertCalls.length, 0);
});

test("marks every matching assignment COMPLETED with the clamped quiz score", async () => {
  findManyResult = [{ id: "asgn-1" }, { id: "asgn-2" }];
  const { markAssignmentQuizComplete } = await load();
  const result = await markAssignmentQuizComplete({
    userId: "student-1",
    articleId: "article-1",
    scorePct: 87,
  });
  assert.deepEqual(result, { completedCount: 2 });
  assert.equal(upsertCalls.length, 2);
  for (const call of upsertCalls) {
    const c = call as {
      where: { assignmentId_studentId: { studentId: string } };
      update: { status: string; quizScore: number; completionSource: AssignmentCompletionSource };
      create: {
        status: string;
        quizScore: number;
        completionSource: AssignmentCompletionSource;
        studentId: string;
      };
    };
    assert.equal(c.where.assignmentId_studentId.studentId, "student-1");
    assert.equal(c.update.status, "COMPLETED");
    assert.equal(c.update.quizScore, 87);
    assert.equal(c.update.completionSource, AssignmentCompletionSource.QUIZ);
    assert.equal(c.create.status, "COMPLETED");
    assert.equal(c.create.completionSource, AssignmentCompletionSource.QUIZ);
    assert.equal(c.create.studentId, "student-1");
  }
});

test("clamps out-of-range scores to 0–100 and rounds", async () => {
  findManyResult = [{ id: "asgn-1" }];
  const { markAssignmentQuizComplete } = await load();
  await markAssignmentQuizComplete({ userId: "s", articleId: "a", scorePct: 142.6 });
  const high = upsertCalls[0] as { update: { quizScore: number } };
  assert.equal(high.update.quizScore, 100);

  upsertCalls.length = 0;
  await markAssignmentQuizComplete({ userId: "s", articleId: "a", scorePct: -5 });
  const low = upsertCalls[0] as { update: { quizScore: number } };
  assert.equal(low.update.quizScore, 0);
});

test("idempotent re-attempt overwrites the score via the upsert update path", async () => {
  findManyResult = [{ id: "asgn-1" }];
  const { markAssignmentQuizComplete } = await load();
  await markAssignmentQuizComplete({ userId: "s", articleId: "a", scorePct: 55 });
  const first = upsertCalls[0] as {
    where: { assignmentId_studentId: { assignmentId: string; studentId: string } };
    update: { quizScore: number; completedAt: Date };
  };
  assert.deepEqual(first.where.assignmentId_studentId, {
    assignmentId: "asgn-1",
    studentId: "s",
  });
  assert.equal(first.update.quizScore, 55);
  assert.ok(first.update.completedAt instanceof Date);
});

test("reviewAssignmentCompletion persists awarded points", async () => {
  const { reviewAssignmentCompletion } = await load();
  await reviewAssignmentCompletion("asgn-1", "student-1", {
    feedback: "Great",
    pointsAwarded: 9,
    reviewedBy: "teacher-1",
  });

  const call = upsertCalls[0] as {
    update: { pointsAwarded: number };
    create: { pointsAwarded: number };
  };
  assert.equal(call.update.pointsAwarded, 9);
  assert.equal(call.create.pointsAwarded, 9);
});

test("reviewAssignmentCompletion leaves awarded points unchanged when absent", async () => {
  const { reviewAssignmentCompletion } = await load();
  await reviewAssignmentCompletion("asgn-1", "student-1", {
    feedback: "Updated",
    reviewedBy: "teacher-1",
  });

  const call = upsertCalls[0] as {
    update: Record<string, unknown>;
    create: { pointsAwarded: number | null };
  };
  assert.equal(Object.hasOwn(call.update, "pointsAwarded"), false);
  assert.equal(call.create.pointsAwarded, null);
});

test("reviewAssignmentCompletion clears awarded points with explicit null", async () => {
  const { reviewAssignmentCompletion } = await load();
  await reviewAssignmentCompletion("asgn-1", "student-1", {
    feedback: null,
    pointsAwarded: null,
    reviewedBy: "teacher-1",
  });

  const call = upsertCalls[0] as {
    update: { pointsAwarded: number | null };
    create: { pointsAwarded: number | null };
  };
  assert.equal(call.update.pointsAwarded, null);
  assert.equal(call.create.pointsAwarded, null);
});
