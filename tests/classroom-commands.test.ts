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
let assignmentDeleteManyArgs: unknown = null;
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
    },
    assignment: {
      deleteMany: async (args: unknown) => {
        assignmentDeleteManyArgs = args;
        return { count: 1 };
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
  assignmentDeleteManyArgs = null;
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

// ---- removeClassroomMember -------------------------------------------------

test("removeClassroomMember deletes the membership by classroomId and userId", async () => {
  const { removeClassroomMember } = await loadCommands();
  await removeClassroomMember("c1", "s1");
  assert.ok(membershipDeleteManyArgs, "deleteMany must be called");
  const args = membershipDeleteManyArgs as { where: { classroomId: string; userId: string } };
  assert.equal(args.where.classroomId, "c1");
  assert.equal(args.where.userId, "s1");
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
