/**
 * Unit tests for syncAssignmentReadingProgress (classroom/completions.ts).
 *
 * Verifies the monotonic no-regression lifecycle: reading progress advances
 * assignments from ASSIGNED → IN_PROGRESS → COMPLETED but never downgrades
 * status, never clobbers a quizScore, and keeps completedAt sticky. The
 * enrollment + archived-classroom gate lives in the Prisma where clause; tests
 * confirm both the where shape and the short-circuit path.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  AssignmentCompletionSource,
  AssignmentStatus,
  Prisma,
} from "@prisma/client";

let assignmentFindManyArgs: unknown = null;
let assignmentFindManyResult: Array<{ id: string }> = [];
let completionFindManyResult: Array<{
  assignmentId: string;
  status: AssignmentStatus;
  quizScore: number | null;
  completionSource?: AssignmentCompletionSource | null;
  completedAt: Date | null;
}> = [];
const upsertCalls: Array<Record<string, unknown>> = [];
const updateManyCalls: Array<Record<string, unknown>> = [];
let beforeNextUpdateMany: (() => void) | null = null;

function completionFor(assignmentId: string) {
  return completionFindManyResult.find((row) => row.assignmentId === assignmentId);
}

function statusMatches(
  status: AssignmentStatus,
  expected: AssignmentStatus | { not: AssignmentStatus },
): boolean {
  return typeof expected === "string"
    ? status === expected
    : status !== expected.not;
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        assignment: {
          findFirst: async () => null,
          findMany: async (args: unknown) => {
            assignmentFindManyArgs = args;
            return assignmentFindManyResult;
          },
        },
        assignmentCompletion: {
          updateMany: async (args: {
            where: {
              assignmentId: string;
              studentId: string;
              status: AssignmentStatus | { not: AssignmentStatus };
              completionSource?: null;
            };
            data: Record<string, unknown>;
          }) => {
            updateManyCalls.push(args);
            if (beforeNextUpdateMany) {
              const hook = beforeNextUpdateMany;
              beforeNextUpdateMany = null;
              hook();
            }
            const row = completionFor(args.where.assignmentId);
            if (
              !row ||
              !statusMatches(row.status, args.where.status) ||
              (args.where.completionSource === null &&
                row.completionSource != null)
            ) {
              return { count: 0 };
            }
            Object.assign(row, args.data);
            upsertCalls.push({
              where: {
                assignmentId_studentId: {
                  assignmentId: args.where.assignmentId,
                  studentId: args.where.studentId,
                },
              },
              update: args.data,
              create: {},
            });
            return { count: 1 };
          },
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const assignmentId = String(data.assignmentId);
            if (completionFor(assignmentId)) {
              throw new Prisma.PrismaClientKnownRequestError("unique", {
                code: "P2002",
                clientVersion: "test",
              });
            }
            completionFindManyResult.push({
              assignmentId,
              status: data.status as AssignmentStatus,
              quizScore: (data.quizScore as number | null) ?? null,
              completionSource:
                (data.completionSource as AssignmentCompletionSource | null) ??
                null,
              completedAt: (data.completedAt as Date | null) ?? null,
            });
            upsertCalls.push({
              where: {
                assignmentId_studentId: {
                  assignmentId,
                  studentId: data.studentId,
                },
              },
              update: {
                status: data.status,
                ...(data.completionSource !== undefined
                  ? { completionSource: data.completionSource }
                  : {}),
                completedAt: data.completedAt,
              },
              create: data,
            });
            return data;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  assignmentFindManyArgs = null;
  assignmentFindManyResult = [];
  completionFindManyResult = [];
  upsertCalls.length = 0;
  updateManyCalls.length = 0;
  beforeNextUpdateMany = null;
});

async function load(): Promise<typeof import("@/lib/classroom/completions")> {
  return import("@/lib/classroom/completions");
}

// ---------------------------------------------------------------------------
// Short-circuit: no DB access when below start percent and not completed
// ---------------------------------------------------------------------------

test("short-circuits below start percent without any DB read when not completed", async () => {
  const { syncAssignmentReadingProgress } = await load();
  const result = await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 0,
    completed: false,
  });
  assert.deepEqual(result, { updatedCount: 0 });
  assert.equal(assignmentFindManyArgs, null, "no DB read should occur");
  assert.equal(upsertCalls.length, 0);
});

test("does NOT short-circuit when completed=true even if percent is 0", async () => {
  assignmentFindManyResult = [];
  const { syncAssignmentReadingProgress } = await load();
  const result = await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 0,
    completed: true,
  });
  assert.deepEqual(result, { updatedCount: 0 });
  assert.notEqual(assignmentFindManyArgs, null, "DB read must occur");
});

// ---------------------------------------------------------------------------
// ASSIGNED → IN_PROGRESS (no existing row, reading below threshold)
// ---------------------------------------------------------------------------

test("creates IN_PROGRESS row when reading reaches start percent with no prior completion", async () => {
  assignmentFindManyResult = [{ id: "asgn-1" }];
  completionFindManyResult = [];
  const { syncAssignmentReadingProgress } = await load();
  const result = await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 50,
    completed: false,
  });
  assert.deepEqual(result, { updatedCount: 1 });
  assert.equal(upsertCalls.length, 1);
  const call = upsertCalls[0] as {
    where: { assignmentId_studentId: { assignmentId: string; studentId: string } };
    update: Record<string, unknown>;
    create: Record<string, unknown>;
  };
  assert.deepEqual(call.where.assignmentId_studentId, {
    assignmentId: "asgn-1",
    studentId: "student-1",
  });
  assert.equal(call.update.status, AssignmentStatus.IN_PROGRESS);
  assert.equal(call.update.completedAt, null);
  assert.equal("quizScore" in call.update, false, "quizScore must not appear in update");
  assert.equal("completionSource" in call.update, false, "completionSource must not appear in update");
  assert.equal(call.create.status, AssignmentStatus.IN_PROGRESS);
  assert.equal(call.create.completedAt, null);
  assert.equal(call.create.quizScore, null);
  assert.equal("completionSource" in call.create, false, "IN_PROGRESS rows have no source");
});

// ---------------------------------------------------------------------------
// IN_PROGRESS → COMPLETED (reading reaches threshold)
// ---------------------------------------------------------------------------

test("upserts COMPLETED with completedAt when completed=true and no prior row", async () => {
  assignmentFindManyResult = [{ id: "asgn-1" }];
  completionFindManyResult = [];
  const { syncAssignmentReadingProgress } = await load();
  const result = await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 95,
    completed: true,
  });
  assert.deepEqual(result, { updatedCount: 1 });
  const call = upsertCalls[0] as {
    update: Record<string, unknown>;
    create: Record<string, unknown>;
  };
  assert.equal(call.update.status, AssignmentStatus.COMPLETED);
  assert.ok(call.update.completedAt instanceof Date, "completedAt should be stamped");
  assert.equal("quizScore" in call.update, false, "quizScore must not appear in update");
  assert.equal(call.update.completionSource, AssignmentCompletionSource.READING);
  assert.equal(call.create.status, AssignmentStatus.COMPLETED);
  assert.ok(call.create.completedAt instanceof Date);
  assert.equal(call.create.quizScore, null);
  assert.equal(call.create.completionSource, AssignmentCompletionSource.READING);
});

test("upgrades IN_PROGRESS to COMPLETED and stamps completedAt", async () => {
  assignmentFindManyResult = [{ id: "asgn-1" }];
  completionFindManyResult = [
    { assignmentId: "asgn-1", status: AssignmentStatus.IN_PROGRESS, quizScore: null, completedAt: null },
  ];
  const { syncAssignmentReadingProgress } = await load();
  const result = await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 95,
    completed: true,
  });
  assert.deepEqual(result, { updatedCount: 1 });
  const call = upsertCalls[0] as { update: Record<string, unknown> };
  assert.equal(call.update.status, AssignmentStatus.COMPLETED);
  assert.ok(call.update.completedAt instanceof Date, "completedAt should be stamped");
  assert.equal("quizScore" in call.update, false, "quizScore must not be touched");
  assert.equal(call.update.completionSource, AssignmentCompletionSource.READING);
});

test("does not overwrite an existing quiz or self completion source on reading completion", async () => {
  const cases = [AssignmentCompletionSource.QUIZ, AssignmentCompletionSource.SELF];
  const { syncAssignmentReadingProgress } = await load();

  for (const source of cases) {
    assignmentFindManyResult = [{ id: "asgn-1" }];
    completionFindManyResult = [
      {
        assignmentId: "asgn-1",
        status: AssignmentStatus.IN_PROGRESS,
        quizScore: null,
        completionSource: source,
        completedAt: null,
      },
    ];
    upsertCalls.length = 0;

    const result = await syncAssignmentReadingProgress({
      userId: "student-1",
      articleId: "article-1",
      percent: 95,
      completed: true,
    });

    assert.deepEqual(result, { updatedCount: 1 });
    const call = upsertCalls[0] as { update: Record<string, unknown> };
    assert.equal("completionSource" in call.update, false, `${source} source must stay sticky`);
  }
});

// ---------------------------------------------------------------------------
// No-regression: COMPLETED is never downgraded; quizScore is never clobbered
// ---------------------------------------------------------------------------

test("skips write for already-COMPLETED assignment — preserves quizScore", async () => {
  assignmentFindManyResult = [{ id: "asgn-1" }];
  completionFindManyResult = [
    {
      assignmentId: "asgn-1",
      status: AssignmentStatus.COMPLETED,
      quizScore: 82,
      completedAt: new Date("2026-07-01"),
    },
  ];
  const { syncAssignmentReadingProgress } = await load();
  const result = await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 95,
    completed: true,
  });
  assert.deepEqual(result, { updatedCount: 0 });
  assert.equal(upsertCalls.length, 0, "no write — already COMPLETED");
});

test("does not downgrade COMPLETED to IN_PROGRESS from a sub-threshold read", async () => {
  assignmentFindManyResult = [{ id: "asgn-1" }];
  completionFindManyResult = [
    {
      assignmentId: "asgn-1",
      status: AssignmentStatus.COMPLETED,
      quizScore: null,
      completedAt: new Date("2026-07-01"),
    },
  ];
  const { syncAssignmentReadingProgress } = await load();
  const result = await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 50,
    completed: false,
  });
  assert.deepEqual(result, { updatedCount: 0 });
  assert.equal(upsertCalls.length, 0, "no downgrade from COMPLETED");
});

test("skips redundant write when status is already IN_PROGRESS", async () => {
  assignmentFindManyResult = [{ id: "asgn-1" }];
  completionFindManyResult = [
    { assignmentId: "asgn-1", status: AssignmentStatus.IN_PROGRESS, quizScore: null, completedAt: null },
  ];
  const { syncAssignmentReadingProgress } = await load();
  const result = await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 50,
    completed: false,
  });
  assert.deepEqual(result, { updatedCount: 0 });
  assert.equal(upsertCalls.length, 0, "no redundant IN_PROGRESS write");
});

// ---------------------------------------------------------------------------
// Sticky completedAt: existing completedAt must not be overwritten
// ---------------------------------------------------------------------------

test("does not overwrite sticky completedAt when existing COMPLETED row has one", async () => {
  const originalCompletedAt = new Date("2026-07-01");
  assignmentFindManyResult = [{ id: "asgn-1" }];
  // No write happens at all because COMPLETED(2) >= COMPLETED(2), so upsert not called.
  // Sticky guard in update payload is the safety net for any future edge case.
  completionFindManyResult = [
    {
      assignmentId: "asgn-1",
      status: AssignmentStatus.COMPLETED,
      quizScore: null,
      completedAt: originalCompletedAt,
    },
  ];
  const { syncAssignmentReadingProgress } = await load();
  await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 100,
    completed: true,
  });
  assert.equal(upsertCalls.length, 0, "no write — no regression possible");
});

test("a delayed reading write cannot downgrade a concurrent quiz completion", async () => {
  const quizCompletedAt = new Date("2026-07-02T00:00:00Z");
  assignmentFindManyResult = [{ id: "asgn-1" }];
  completionFindManyResult = [
    {
      assignmentId: "asgn-1",
      status: AssignmentStatus.IN_PROGRESS,
      quizScore: null,
      completionSource: null,
      completedAt: null,
    },
  ];
  beforeNextUpdateMany = () => {
    Object.assign(completionFindManyResult[0], {
      status: AssignmentStatus.COMPLETED,
      quizScore: 100,
      completionSource: AssignmentCompletionSource.QUIZ,
      completedAt: quizCompletedAt,
    });
  };

  const { syncAssignmentReadingProgress } = await load();
  const result = await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 50,
    completed: false,
  });

  assert.deepEqual(result, { updatedCount: 0 });
  assert.deepEqual(completionFindManyResult[0], {
    assignmentId: "asgn-1",
    status: AssignmentStatus.COMPLETED,
    quizScore: 100,
    completionSource: AssignmentCompletionSource.QUIZ,
    completedAt: quizCompletedAt,
  });
});

// ---------------------------------------------------------------------------
// Multi-classroom: article assigned in 2 enrolled classrooms
// ---------------------------------------------------------------------------

test("advances all assignments when article is assigned across multiple classrooms", async () => {
  assignmentFindManyResult = [{ id: "asgn-1" }, { id: "asgn-2" }];
  completionFindManyResult = [];
  const { syncAssignmentReadingProgress } = await load();
  const result = await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 50,
    completed: false,
  });
  assert.deepEqual(result, { updatedCount: 2 });
  assert.equal(upsertCalls.length, 2);
  const assignmentIds = upsertCalls.map(
    (c) =>
      (c as { where: { assignmentId_studentId: { assignmentId: string } } }).where
        .assignmentId_studentId.assignmentId,
  );
  assert.deepEqual(assignmentIds.sort(), ["asgn-1", "asgn-2"]);
});

test("handles mixed states in multi-classroom: upgrades only those below target", async () => {
  assignmentFindManyResult = [{ id: "asgn-1" }, { id: "asgn-2" }];
  completionFindManyResult = [
    // asgn-1 already COMPLETED — skip
    { assignmentId: "asgn-1", status: AssignmentStatus.COMPLETED, quizScore: 75, completedAt: new Date() },
    // asgn-2 IN_PROGRESS — upgrade to COMPLETED
    { assignmentId: "asgn-2", status: AssignmentStatus.IN_PROGRESS, quizScore: null, completedAt: null },
  ];
  const { syncAssignmentReadingProgress } = await load();
  const result = await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 95,
    completed: true,
  });
  assert.deepEqual(result, { updatedCount: 1 });
  assert.equal(upsertCalls.length, 1);
  const written = upsertCalls[0] as {
    where: { assignmentId_studentId: { assignmentId: string } };
  };
  assert.equal(written.where.assignmentId_studentId.assignmentId, "asgn-2");
});

// ---------------------------------------------------------------------------
// Enrollment + archived-classroom gate (where clause)
// ---------------------------------------------------------------------------

test("excludes non-enrolled students via the where clause — returns updatedCount 0", async () => {
  assignmentFindManyResult = [];
  const { syncAssignmentReadingProgress } = await load();
  const result = await syncAssignmentReadingProgress({
    userId: "outsider",
    articleId: "article-1",
    percent: 50,
    completed: false,
  });
  assert.deepEqual(result, { updatedCount: 0 });
  assert.equal(upsertCalls.length, 0);
  const args = assignmentFindManyArgs as {
    where: {
      articleId: string;
      classroom: { archivedAt: null; members: { some: { userId: string } } };
      AND: Array<{ OR: unknown[] }>;
    };
  };
  assert.equal(args.where.classroom.archivedAt, null, "must filter archived classrooms");
  assert.deepEqual(args.where.classroom.members.some, { userId: "outsider" }, "must scope to enrolled student");
  assert.deepEqual(args.where.AND[0].OR, [
    { wholeClass: true },
    { wholeClass: false, targets: { some: { studentId: "outsider" } } },
  ]);
  assert.deepEqual(args.where.AND[1].OR[0], { publishState: "PUBLISHED" });
});

test("excludes archived classrooms — findMany returns empty when all are archived", async () => {
  assignmentFindManyResult = [];
  const { syncAssignmentReadingProgress } = await load();
  const result = await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 50,
    completed: false,
  });
  assert.deepEqual(result, { updatedCount: 0 });
  const args = assignmentFindManyArgs as {
    where: { classroom: { archivedAt: null } };
  };
  assert.equal(args.where.classroom.archivedAt, null);
});

// ---------------------------------------------------------------------------
// Completion findMany scoping
// ---------------------------------------------------------------------------

test("scopes atomic completion transitions to each assignment and student", async () => {
  assignmentFindManyResult = [{ id: "asgn-1" }, { id: "asgn-2" }];
  completionFindManyResult = [];
  const { syncAssignmentReadingProgress } = await load();
  await syncAssignmentReadingProgress({
    userId: "student-1",
    articleId: "article-1",
    percent: 50,
    completed: false,
  });
  assert.deepEqual(
    [...new Set(updateManyCalls.map((call) =>
      (call.where as { assignmentId: string }).assignmentId,
    ))].sort(),
    ["asgn-1", "asgn-2"],
  );
  assert.ok(
    updateManyCalls.every(
      (call) =>
        (call.where as { studentId: string }).studentId === "student-1",
    ),
  );
});
