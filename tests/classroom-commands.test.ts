/**
 * Unit tests for classroom mutation commands (classroom/commands.ts).
 *
 * Verifies createClassroom (transaction, name trimming, teacher seating),
 * addClassroomMember (upsert, default role, re-role idempotency),
 * removeClassroomMember, assignArticle (instructions trimming, null dueDate),
 * and deleteAssignment. All Prisma calls are mocked — no real DB is touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mutable stub state ---------------------------------------------------

let createdClassroom: Record<string, unknown> = { id: "c1", name: "Math", orgId: "o1", teacherId: "t1" };
let upsertedMembership: Record<string, unknown> = { classroomId: "c1", userId: "s1", role: "Student" };
let createdAssignment: Record<string, unknown> = {
  id: "asgn1",
  classroomId: "c1",
  articleId: "art1",
  dueDate: null,
  instructions: null,
};

// Call recorders
let classroomCreateArgs: unknown = null;
let membershipCreateArgs: unknown = null;
let membershipUpsertArgs: unknown = null;
let membershipDeleteManyArgs: unknown = null;
let assignmentCreateArgs: unknown = null;
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
      create: async (args: unknown) => {
        assignmentCreateArgs = args;
        return createdAssignment;
      },
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

beforeEach(() => {
  createdClassroom = { id: "c1", name: "Math", orgId: "o1", teacherId: "t1" };
  upsertedMembership = { classroomId: "c1", userId: "s1", role: "Student" };
  createdAssignment = { id: "asgn1", classroomId: "c1", articleId: "art1", dueDate: null, instructions: null };
  classroomCreateArgs = null;
  membershipCreateArgs = null;
  membershipUpsertArgs = null;
  membershipDeleteManyArgs = null;
  assignmentCreateArgs = null;
  assignmentDeleteManyArgs = null;
  transactionCalled = false;
});

// ---- createClassroom -------------------------------------------------------

test("createClassroom creates the classroom and teacher membership inside a transaction", async () => {
  const { createClassroom } = await import("@/lib/classroom/commands");
  const result = await createClassroom({ orgId: "o1", name: "Math", teacherId: "t1" });
  assert.equal(transactionCalled, true);
  assert.deepEqual(result, createdClassroom);
  assert.ok(classroomCreateArgs, "classroom.create must be called");
  assert.ok(membershipCreateArgs, "classroomMembership.create must be called");
});

test("createClassroom trims whitespace from the classroom name", async () => {
  const { createClassroom } = await import("@/lib/classroom/commands");
  await createClassroom({ orgId: "o1", name: "  Trimmed Name  ", teacherId: "t1" });
  const args = classroomCreateArgs as { data: { name: string } };
  assert.equal(args.data.name, "Trimmed Name");
});

test("createClassroom seats the teacher as a Teacher member", async () => {
  const { createClassroom } = await import("@/lib/classroom/commands");
  await createClassroom({ orgId: "o1", name: "Class A", teacherId: "teacher-99" });
  const mArgs = membershipCreateArgs as { data: { userId: string; role: string } };
  assert.equal(mArgs.data.userId, "teacher-99");
  assert.equal(mArgs.data.role, "Teacher");
});

test("createClassroom stores the correct orgId and teacherId on the classroom", async () => {
  const { createClassroom } = await import("@/lib/classroom/commands");
  await createClassroom({ orgId: "org-X", name: "Org X Class", teacherId: "t-X" });
  const args = classroomCreateArgs as { data: { orgId: string; teacherId: string } };
  assert.equal(args.data.orgId, "org-X");
  assert.equal(args.data.teacherId, "t-X");
});

test("createClassroom links the membership to the correct classroom", async () => {
  const { createClassroom } = await import("@/lib/classroom/commands");
  await createClassroom({ orgId: "o1", name: "Link Test", teacherId: "t1" });
  const mArgs = membershipCreateArgs as { data: { classroomId: string } };
  // The membership classroomId must equal the newly created classroom's id.
  assert.equal(mArgs.data.classroomId, createdClassroom.id);
});

// ---- addClassroomMember ----------------------------------------------------

test("addClassroomMember upserts with Student role by default", async () => {
  const { addClassroomMember } = await import("@/lib/classroom/commands");
  const result = await addClassroomMember("c1", "s1");
  assert.deepEqual(result, upsertedMembership);
  const args = membershipUpsertArgs as { create: { role: string }; update: { role: string } };
  assert.equal(args.create.role, "Student");
  assert.equal(args.update.role, "Student");
});

test("addClassroomMember upserts with an explicitly provided role", async () => {
  upsertedMembership = { classroomId: "c1", userId: "t2", role: "Teacher" };
  const { addClassroomMember } = await import("@/lib/classroom/commands");
  const result = await addClassroomMember("c1", "t2", "Teacher");
  assert.deepEqual(result, upsertedMembership);
  const args = membershipUpsertArgs as { create: { role: string }; update: { role: string } };
  assert.equal(args.create.role, "Teacher");
  assert.equal(args.update.role, "Teacher");
});

test("addClassroomMember uses the classroomId_userId composite key for the upsert where clause", async () => {
  const { addClassroomMember } = await import("@/lib/classroom/commands");
  await addClassroomMember("c1", "s1");
  const args = membershipUpsertArgs as {
    where: { classroomId_userId: { classroomId: string; userId: string } };
  };
  assert.deepEqual(args.where.classroomId_userId, { classroomId: "c1", userId: "s1" });
});

test("addClassroomMember is idempotent — re-roles an existing member via update", async () => {
  upsertedMembership = { classroomId: "c1", userId: "s1", role: "Teacher" };
  const { addClassroomMember } = await import("@/lib/classroom/commands");
  const result = await addClassroomMember("c1", "s1", "Teacher");
  assert.deepEqual(result, upsertedMembership);
  const args = membershipUpsertArgs as { update: { role: string } };
  assert.equal(args.update.role, "Teacher");
});

// ---- removeClassroomMember -------------------------------------------------

test("removeClassroomMember deletes the membership by classroomId and userId", async () => {
  const { removeClassroomMember } = await import("@/lib/classroom/commands");
  await removeClassroomMember("c1", "s1");
  assert.ok(membershipDeleteManyArgs, "deleteMany must be called");
  const args = membershipDeleteManyArgs as { where: { classroomId: string; userId: string } };
  assert.equal(args.where.classroomId, "c1");
  assert.equal(args.where.userId, "s1");
});

test("removeClassroomMember resolves without error when member does not exist", async () => {
  const { removeClassroomMember } = await import("@/lib/classroom/commands");
  await assert.doesNotReject(() => removeClassroomMember("c1", "nonexistent-user"));
});

test("removeClassroomMember returns void (no useful return value)", async () => {
  const { removeClassroomMember } = await import("@/lib/classroom/commands");
  const result = await removeClassroomMember("c1", "s1");
  assert.equal(result, undefined);
});

// ---- assignArticle ---------------------------------------------------------

test("assignArticle creates an assignment with the provided classroomId and articleId", async () => {
  const { assignArticle } = await import("@/lib/classroom/commands");
  const result = await assignArticle({ classroomId: "c1", articleId: "art1" });
  assert.deepEqual(result, createdAssignment);
  const args = assignmentCreateArgs as { data: { classroomId: string; articleId: string } };
  assert.equal(args.data.classroomId, "c1");
  assert.equal(args.data.articleId, "art1");
});

test("assignArticle stores the dueDate when provided", async () => {
  const dueDate = new Date("2026-12-31");
  const { assignArticle } = await import("@/lib/classroom/commands");
  await assignArticle({ classroomId: "c1", articleId: "art1", dueDate });
  const args = assignmentCreateArgs as { data: { dueDate: Date } };
  assert.deepEqual(args.data.dueDate, dueDate);
});

test("assignArticle stores null for dueDate when not provided", async () => {
  const { assignArticle } = await import("@/lib/classroom/commands");
  await assignArticle({ classroomId: "c1", articleId: "art1" });
  const args = assignmentCreateArgs as { data: { dueDate: null } };
  assert.equal(args.data.dueDate, null);
});

test("assignArticle stores null for dueDate when explicitly set to null", async () => {
  const { assignArticle } = await import("@/lib/classroom/commands");
  await assignArticle({ classroomId: "c1", articleId: "art1", dueDate: null });
  const args = assignmentCreateArgs as { data: { dueDate: null } };
  assert.equal(args.data.dueDate, null);
});

test("assignArticle trims whitespace from instructions", async () => {
  const { assignArticle } = await import("@/lib/classroom/commands");
  await assignArticle({ classroomId: "c1", articleId: "art1", instructions: "  Read carefully  " });
  const args = assignmentCreateArgs as { data: { instructions: string } };
  assert.equal(args.data.instructions, "Read carefully");
});

test("assignArticle stores null when instructions is an empty string", async () => {
  const { assignArticle } = await import("@/lib/classroom/commands");
  await assignArticle({ classroomId: "c1", articleId: "art1", instructions: "" });
  const args = assignmentCreateArgs as { data: { instructions: null } };
  assert.equal(args.data.instructions, null);
});

test("assignArticle stores null when instructions is whitespace only", async () => {
  const { assignArticle } = await import("@/lib/classroom/commands");
  await assignArticle({ classroomId: "c1", articleId: "art1", instructions: "   " });
  const args = assignmentCreateArgs as { data: { instructions: null } };
  assert.equal(args.data.instructions, null);
});

test("assignArticle stores null when instructions is not provided", async () => {
  const { assignArticle } = await import("@/lib/classroom/commands");
  await assignArticle({ classroomId: "c1", articleId: "art1" });
  const args = assignmentCreateArgs as { data: { instructions: null } };
  assert.equal(args.data.instructions, null);
});

// ---- deleteAssignment ------------------------------------------------------

test("deleteAssignment calls deleteMany with the assignment id", async () => {
  const { deleteAssignment } = await import("@/lib/classroom/commands");
  await deleteAssignment("asgn-1");
  assert.ok(assignmentDeleteManyArgs, "deleteMany must be called");
  const args = assignmentDeleteManyArgs as { where: { id: string } };
  assert.equal(args.where.id, "asgn-1");
});

test("deleteAssignment resolves without error when assignment does not exist", async () => {
  const { deleteAssignment } = await import("@/lib/classroom/commands");
  await assert.doesNotReject(() => deleteAssignment("nonexistent-asgn"));
});

test("deleteAssignment returns void (no useful return value)", async () => {
  const { deleteAssignment } = await import("@/lib/classroom/commands");
  const result = await deleteAssignment("asgn-1");
  assert.equal(result, undefined);
});
