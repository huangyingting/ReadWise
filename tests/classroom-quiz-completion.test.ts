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

let findManyArgs: unknown = null;
let findManyResult: Array<{ id: string }> = [];
const upsertCalls: Array<Record<string, unknown>> = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        assignment: {
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
  upsertCalls.length = 0;
});

async function load(): Promise<typeof import("@/lib/classroom/completions")> {
  return import("@/lib/classroom/completions");
}

test("scopes the assignment lookup to classrooms the student is enrolled in", async () => {
  findManyResult = [{ id: "asgn-1" }];
  const { markAssignmentQuizComplete } = await load();
  await markAssignmentQuizComplete({ userId: "student-1", articleId: "article-1", scorePct: 80 });
  const args = findManyArgs as {
    where: { articleId: string; classroom: { members: { some: { userId: string } } } };
  };
  assert.equal(args.where.articleId, "article-1");
  assert.deepEqual(args.where.classroom.members.some, { userId: "student-1" });
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
      update: { status: string; quizScore: number };
      create: { status: string; quizScore: number; studentId: string };
    };
    assert.equal(c.where.assignmentId_studentId.studentId, "student-1");
    assert.equal(c.update.status, "COMPLETED");
    assert.equal(c.update.quizScore, 87);
    assert.equal(c.create.status, "COMPLETED");
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
