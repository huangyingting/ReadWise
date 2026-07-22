/**
 * Unit tests for classroom mutation commands (classroom/commands.ts).
 *
 * Verifies createClassroom (transaction, name trimming, teacher seating),
 * addClassroomMember (upsert, default role, re-role idempotency),
 * removeClassroomMember, and deleteAssignment. Article-assignment invariants
 * are covered through the focused article-assignments interface suite.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mutable stub state ---------------------------------------------------

const DEFAULT_CLASSROOM = { id: "c1", name: "Math", orgId: "o1", teacherId: "t1" };
const DEFAULT_UPSERTED_MEMBERSHIP = { classroomId: "c1", userId: "s1", role: "Student" };
let createdClassroom: Record<string, unknown> = { ...DEFAULT_CLASSROOM };
let upsertedMembership: Record<string, unknown> = { ...DEFAULT_UPSERTED_MEMBERSHIP };

// Call recorders
let classroomCreateArgs: unknown = null;
let membershipCreateArgs: unknown = null;
let membershipUpsertArgs: unknown = null;
let membershipDeleteManyArgs: unknown = null;
let completionDeleteManyArgs: unknown = null;
let completionUpdateManyArgs: unknown = null;
let completionUpdateManyResult = { count: 2 };
let assignmentDeleteManyArgs: unknown = null;
let assignmentUpdateArgs: unknown = null;
let classroomUpdateArgs: unknown = null;
let classroomFindUniqueArgs: unknown = null;
let classroomDeleteArgs: unknown = null;
let assignmentCountResult = 0;
let membershipCountResult = 0;
let classroomFindUniqueResult: Record<string, unknown> | null = {
  id: "c1",
  teacherId: "t1",
};
let assignmentUpdateResult: Record<string, unknown> = {
  id: "asgn-1",
  classroomId: "c1",
  dueDate: null,
  instructions: null,
  title: null,
  points: null,
};
let transactionCalled = false;

// Module-level ref so $transaction callback can receive it as `tx`
let mockPrisma: Record<string, unknown> = {};

// ---- mock setup ------------------------------------------------------------

before(() => {
  mockPrisma = {
    classroom: {
      create: async (args: unknown) => {
        classroomCreateArgs = args;
        return createdClassroom;
      },
      update: async (args: unknown) => {
        classroomUpdateArgs = args;
        return { ...createdClassroom, ...(args as { data?: Record<string, unknown> }).data };
      },
      findUnique: async (args: unknown) => {
        classroomFindUniqueArgs = args;
        return classroomFindUniqueResult;
      },
      delete: async (args: unknown) => {
        classroomDeleteArgs = args;
        return classroomFindUniqueResult;
      },
    },
    classroomMembership: {
      create: async (args: unknown) => {
        membershipCreateArgs = args;
        return { classroomId: "c1", userId: "t1", role: "Teacher" };
      },
      upsert: async (args: unknown) => {
        membershipUpsertArgs = args;
        return upsertedMembership;
      },
      deleteMany: async (args: unknown) => {
        membershipDeleteManyArgs = args;
        return { count: 1 };
      },
      count: async () => membershipCountResult,
    },
    assignmentCompletion: {
      deleteMany: async (args: unknown) => {
        completionDeleteManyArgs = args;
        return { count: 1 };
      },
      updateMany: async (args: unknown) => {
        completionUpdateManyArgs = args;
        return completionUpdateManyResult;
      },
    },
    assignment: {
      deleteMany: async (args: unknown) => {
        assignmentDeleteManyArgs = args;
        return { count: 1 };
      },
      count: async () => assignmentCountResult,
      update: async (args: unknown) => {
        assignmentUpdateArgs = args;
        return assignmentUpdateResult;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      transactionCalled = true;
      return fn(mockPrisma);
    },
  };

  mock.module("@/lib/prisma", { namedExports: { prisma: mockPrisma } });
});

async function loadCommands(): Promise<typeof import("@/lib/classroom/commands")> {
  return import("@/lib/classroom/commands");
}

beforeEach(() => {
  createdClassroom = { ...DEFAULT_CLASSROOM };
  upsertedMembership = { ...DEFAULT_UPSERTED_MEMBERSHIP };
  classroomCreateArgs = null;
  membershipCreateArgs = null;
  membershipUpsertArgs = null;
  membershipDeleteManyArgs = null;
  completionDeleteManyArgs = null;
  completionUpdateManyArgs = null;
  completionUpdateManyResult = { count: 2 };
  assignmentDeleteManyArgs = null;
  assignmentUpdateArgs = null;
  classroomUpdateArgs = null;
  classroomFindUniqueArgs = null;
  classroomDeleteArgs = null;
  assignmentCountResult = 0;
  membershipCountResult = 0;
  classroomFindUniqueResult = { id: "c1", teacherId: "t1" };
  assignmentUpdateResult = {
    id: "asgn-1",
    classroomId: "c1",
    dueDate: null,
    instructions: null,
    title: null,
    points: null,
  };
  transactionCalled = false;
});

// ---- createClassroom -------------------------------------------------------

test("createClassroom creates the classroom and teacher membership inside a transaction", async () => {
  const { createClassroom } = await loadCommands();
  const result = await createClassroom({ orgId: "o1", name: "Math", teacherId: "t1" });
  assert.equal(transactionCalled, true);
  assert.deepEqual(result, createdClassroom);
  assert.ok(classroomCreateArgs, "classroom.create must be called");
  assert.ok(membershipCreateArgs, "classroomMembership.create must be called");
});

test("createClassroom trims whitespace from the classroom name", async () => {
  const { createClassroom } = await loadCommands();
  await createClassroom({ orgId: "o1", name: "  Trimmed Name  ", teacherId: "t1" });
  const args = classroomCreateArgs as { data: { name: string } };
  assert.equal(args.data.name, "Trimmed Name");
});

test("createClassroom seats the teacher as a Teacher member", async () => {
  const { createClassroom } = await loadCommands();
  await createClassroom({ orgId: "o1", name: "Class A", teacherId: "teacher-99" });
  const mArgs = membershipCreateArgs as { data: { userId: string; role: string } };
  assert.equal(mArgs.data.userId, "teacher-99");
  assert.equal(mArgs.data.role, "Teacher");
});

test("createClassroom stores the correct orgId and teacherId on the classroom", async () => {
  const { createClassroom } = await loadCommands();
  await createClassroom({ orgId: "org-X", name: "Org X Class", teacherId: "t-X" });
  const args = classroomCreateArgs as { data: { orgId: string; teacherId: string } };
  assert.equal(args.data.orgId, "org-X");
  assert.equal(args.data.teacherId, "t-X");
});

test("createClassroom links the membership to the correct classroom", async () => {
  const { createClassroom } = await loadCommands();
  await createClassroom({ orgId: "o1", name: "Link Test", teacherId: "t1" });
  const mArgs = membershipCreateArgs as { data: { classroomId: string } };
  // The membership classroomId must equal the newly created classroom's id.
  assert.equal(mArgs.data.classroomId, createdClassroom.id);
});

// ---- addClassroomMember ----------------------------------------------------

test("addClassroomMember upserts with Student role by default", async () => {
  const { addClassroomMember } = await loadCommands();
  const result = await addClassroomMember("c1", "s1");
  assert.deepEqual(result, upsertedMembership);
  const args = membershipUpsertArgs as { create: { role: string }; update: { role: string } };
  assert.equal(args.create.role, "Student");
  assert.equal(args.update.role, "Student");
});

test("addClassroomMember upserts with an explicitly provided role", async () => {
  upsertedMembership = { classroomId: "c1", userId: "t2", role: "Teacher" };
  const { addClassroomMember } = await loadCommands();
  const result = await addClassroomMember("c1", "t2", "Teacher");
  assert.deepEqual(result, upsertedMembership);
  const args = membershipUpsertArgs as { create: { role: string }; update: { role: string } };
  assert.equal(args.create.role, "Teacher");
  assert.equal(args.update.role, "Teacher");
});

test("addClassroomMember uses the classroomId_userId composite key for the upsert where clause", async () => {
  const { addClassroomMember } = await loadCommands();
  await addClassroomMember("c1", "s1");
  const args = membershipUpsertArgs as {
    where: { classroomId_userId: { classroomId: string; userId: string } };
  };
  assert.deepEqual(args.where.classroomId_userId, { classroomId: "c1", userId: "s1" });
});

test("addClassroomMember is idempotent — re-roles an existing member via update", async () => {
  upsertedMembership = { classroomId: "c1", userId: "s1", role: "Teacher" };
  const { addClassroomMember } = await loadCommands();
  const result = await addClassroomMember("c1", "s1", "Teacher");
  assert.deepEqual(result, upsertedMembership);
  const args = membershipUpsertArgs as { update: { role: string } };
  assert.equal(args.update.role, "Teacher");
});

// ---- updateClassroomLifecycle ----------------------------------------------

test("updateClassroomLifecycle renames and archives a classroom", async () => {
  const { updateClassroomLifecycle } = await loadCommands();
  const archivedAt = new Date("2026-07-21T03:00:00.000Z");
  const result = await updateClassroomLifecycle(
    "c1",
    { name: "  New Name  ", archived: true },
    archivedAt,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.changed, { name: true, archived: true });
  }
  const args = classroomUpdateArgs as {
    where: { id: string };
    data: { name: string; archivedAt: Date | null };
  };
  assert.equal(args.where.id, "c1");
  assert.equal(args.data.name, "New Name");
  assert.equal(args.data.archivedAt?.toISOString(), archivedAt.toISOString());
});

test("updateClassroomLifecycle unarchives without changing the name", async () => {
  const { updateClassroomLifecycle } = await loadCommands();
  await updateClassroomLifecycle("c1", { archived: false });
  const args = classroomUpdateArgs as { data: { name?: string; archivedAt: Date | null } };
  assert.equal(args.data.name, undefined);
  assert.equal(args.data.archivedAt, null);
});

test("updateClassroomLifecycle rejects an empty lifecycle update", async () => {
  const { updateClassroomLifecycle } = await loadCommands();
  const result = await updateClassroomLifecycle("c1", {});
  assert.deepEqual(result, { ok: false, status: 400, reason: "empty_update" });
  assert.equal(classroomUpdateArgs, null);
});

// ---- deleteClassroom --------------------------------------------------------

test("deleteClassroom hard-deletes an empty classroom", async () => {
  const { deleteClassroom } = await loadCommands();
  const result = await deleteClassroom("c1");
  assert.equal(transactionCalled, true);
  assert.deepEqual(result, { ok: true, deleted: true });
  const findArgs = classroomFindUniqueArgs as { where: { id: string }; select: { teacherId: boolean } };
  assert.equal(findArgs.where.id, "c1");
  const deleteArgs = classroomDeleteArgs as { where: { id: string } };
  assert.equal(deleteArgs.where.id, "c1");
});

test("deleteClassroom blocks classrooms with assignments or non-teacher members", async () => {
  const { deleteClassroom } = await loadCommands();
  assignmentCountResult = 2;
  membershipCountResult = 1;
  const result = await deleteClassroom("c1");
  assert.deepEqual(result, {
    ok: false,
    status: 409,
    reason: "classroom_not_empty",
    assignmentCount: 2,
    memberCount: 1,
  });
  assert.equal(classroomDeleteArgs, null);
});

test("deleteClassroom treats a missing classroom as an idempotent no-op", async () => {
  const { deleteClassroom } = await loadCommands();
  classroomFindUniqueResult = null;
  const result = await deleteClassroom("missing");
  assert.deepEqual(result, { ok: true, deleted: false });
  assert.equal(classroomDeleteArgs, null);
});

// ---- removeClassroomMember -------------------------------------------------

test("removeClassroomMember deletes the membership by classroomId and userId", async () => {
  const { removeClassroomMember } = await loadCommands();
  await removeClassroomMember("c1", "s1");
  assert.ok(membershipDeleteManyArgs, "deleteMany must be called");
  const args = membershipDeleteManyArgs as { where: { classroomId: string; userId: string } };
  assert.equal(args.where.classroomId, "c1");
  assert.equal(args.where.userId, "s1");
});

test("removeClassroomMember runs inside a transaction", async () => {
  const { removeClassroomMember } = await loadCommands();
  await removeClassroomMember("c1", "s1");
  assert.equal(transactionCalled, true);
});

test("removeClassroomMember deletes the student's completions scoped to the classroom's assignments", async () => {
  const { removeClassroomMember } = await loadCommands();
  await removeClassroomMember("c1", "s1");
  assert.ok(completionDeleteManyArgs, "assignmentCompletion.deleteMany must be called");
  const args = completionDeleteManyArgs as {
    where: { studentId: string; assignment: { classroomId: string } };
  };
  assert.equal(args.where.studentId, "s1");
  assert.deepEqual(args.where.assignment, { classroomId: "c1" });
});

test("removeClassroomMember resolves without error when member does not exist", async () => {
  const { removeClassroomMember } = await loadCommands();
  await assert.doesNotReject(() => removeClassroomMember("c1", "nonexistent-user"));
});

test("removeClassroomMember returns void (no useful return value)", async () => {
  const { removeClassroomMember } = await loadCommands();
  const result = await removeClassroomMember("c1", "s1");
  assert.equal(result, undefined);
});

// ---- deleteAssignment ------------------------------------------------------

test("deleteAssignment calls deleteMany with the assignment id", async () => {
  const { deleteAssignment } = await loadCommands();
  await deleteAssignment("asgn-1");
  assert.ok(assignmentDeleteManyArgs, "deleteMany must be called");
  const args = assignmentDeleteManyArgs as { where: { id: string } };
  assert.equal(args.where.id, "asgn-1");
});

test("deleteAssignment resolves without error when assignment does not exist", async () => {
  const { deleteAssignment } = await loadCommands();
  await assert.doesNotReject(() => deleteAssignment("nonexistent-asgn"));
});

test("deleteAssignment returns void (no useful return value)", async () => {
  const { deleteAssignment } = await loadCommands();
  const result = await deleteAssignment("asgn-1");
  assert.equal(result, undefined);
});

// ---- reopenAssignment -------------------------------------------------------

test("reopenAssignment resets non-assigned completions and returns the count", async () => {
  const { reopenAssignment } = await loadCommands();
  completionUpdateManyResult = { count: 3 };

  const result = await reopenAssignment("asgn-1");

  assert.deepEqual(result, { reopened: 3 });
  assert.deepEqual(completionUpdateManyArgs, {
    where: { assignmentId: "asgn-1", status: { not: "ASSIGNED" } },
    data: {
      status: "ASSIGNED",
      completedAt: null,
      completionSource: null,
    },
  });
});

test("reopenAssignment preserves teacher review and quiz fields", async () => {
  const { reopenAssignment } = await loadCommands();

  await reopenAssignment("asgn-1");

  const args = completionUpdateManyArgs as { data: Record<string, unknown> };
  assert.equal("feedback" in args.data, false);
  assert.equal("reviewedAt" in args.data, false);
  assert.equal("reviewedBy" in args.data, false);
  assert.equal("quizScore" in args.data, false);
});

// ---- updateAssignment ------------------------------------------------------

test("updateAssignment updates only instructions when dueDate is omitted", async () => {
  const { updateAssignment } = await loadCommands();
  const result = await updateAssignment("asgn-1", { instructions: "  Read carefully  " });
  assert.deepEqual(result, { ok: true, assignment: assignmentUpdateResult });
  const args = assignmentUpdateArgs as {
    where: { id: string };
    data: Record<string, unknown>;
  };
  assert.equal(args.where.id, "asgn-1");
  assert.deepEqual(args.data, { instructions: "Read carefully" });
});

test("updateAssignment trims blank instructions to null", async () => {
  const { updateAssignment } = await loadCommands();
  await updateAssignment("asgn-1", { instructions: "   " });
  const args = assignmentUpdateArgs as { data: { instructions: string | null } };
  assert.equal(args.data.instructions, null);
});

test("updateAssignment patches title and points when provided", async () => {
  const { updateAssignment } = await loadCommands();
  await updateAssignment("asgn-1", { title: "  Unit review  ", points: 40 });
  const args = assignmentUpdateArgs as { data: { title: string | null; points: number | null } };
  assert.deepEqual(args.data, { title: "Unit review", points: 40 });
});

test("updateAssignment clears title and points when null or blank", async () => {
  const { updateAssignment } = await loadCommands();
  await updateAssignment("asgn-1", { title: "   ", points: null });
  const args = assignmentUpdateArgs as { data: { title: string | null; points: number | null } };
  assert.deepEqual(args.data, { title: null, points: null });
});

test("updateAssignment leaves title and points untouched when absent", async () => {
  const { updateAssignment } = await loadCommands();
  await updateAssignment("asgn-1", { instructions: "Keep going" });
  const args = assignmentUpdateArgs as { data: Record<string, unknown> };
  assert.equal("title" in args.data, false);
  assert.equal("points" in args.data, false);
});

test("updateAssignment parses a valid dueDate into a Date", async () => {
  const { updateAssignment } = await loadCommands();
  await updateAssignment("asgn-1", { dueDate: "2026-08-01T00:00:00.000Z" });
  const args = assignmentUpdateArgs as { data: { dueDate: Date } };
  assert.ok(args.data.dueDate instanceof Date);
  assert.equal(args.data.dueDate.toISOString(), "2026-08-01T00:00:00.000Z");
});

test("updateAssignment rejects an invalid dueDate without touching the row", async () => {
  const { updateAssignment } = await loadCommands();
  const result = await updateAssignment("asgn-1", { dueDate: "not-a-date" });
  assert.deepEqual(result, { ok: false, status: 400, reason: "invalid_due_date" });
  assert.equal(assignmentUpdateArgs, null);
});

test("updateAssignment sends no data keys when the input is empty", async () => {
  const { updateAssignment } = await loadCommands();
  await updateAssignment("asgn-1", {});
  const args = assignmentUpdateArgs as { data: Record<string, unknown> };
  assert.deepEqual(args.data, {});
});
