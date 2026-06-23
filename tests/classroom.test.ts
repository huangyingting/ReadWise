/**
 * Classroom / assignment helper tests (RW-061).
 *
 * `@/lib/prisma` is a configurable fake and `@/lib/org` is stubbed (faithful to
 * the real capability resolution via `@/lib/rbac`) so the access checks and the
 * completion-upsert logic can be tested without a DB.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { AssignmentStatus } from "@prisma/client";
import { membershipHasCapability, type Capability } from "@/lib/rbac";

type Classroom = typeof import("@/lib/classroom");
let cls: Classroom;

let lastUpsert: { update: Record<string, unknown>; create: Record<string, unknown> } | null;
let assignmentRow: { id: string; classroomId: string } | null;

before(async () => {
  const prismaFake = {
    assignmentCompletion: {
      upsert: async (args: { update: Record<string, unknown>; create: Record<string, unknown> }) => {
        lastUpsert = args;
        return { id: "comp1", ...args.create };
      },
    },
    assignment: {
      findFirst: async () => assignmentRow,
    },
  };

  mock.module("@/lib/prisma", { namedExports: { prisma: prismaFake } });
  mock.module("@/lib/org", {
    namedExports: {
      isSystemAdmin: (role: string | null | undefined) =>
        role === "Admin" || role === "System",
      hasOrgCapability: (
        membership: { role: string } | null | undefined,
        capability: string,
      ) => (membership ? membershipHasCapability(membership.role, capability as Capability) : false),
    },
  });

  cls = await import("@/lib/classroom");
});

beforeEach(() => {
  lastUpsert = null;
  assignmentRow = null;
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test("canCreateClassroom: OrgAdmin and Teacher may, plain Member may not", () => {
  assert.ok(cls.canCreateClassroom({ id: "u", role: "Reader" }, { role: "OrgAdmin" }));
  assert.ok(cls.canCreateClassroom({ id: "u", role: "Reader" }, { role: "Teacher" }));
  assert.ok(!cls.canCreateClassroom({ id: "u", role: "Reader" }, { role: "Member" }));
  assert.ok(!cls.canCreateClassroom({ id: "u", role: "Reader" }, null));
  // A system admin can always create.
  assert.ok(cls.canCreateClassroom({ id: "u", role: "Admin" }, null));
});

test("canManageClassroom: the classroom's teacher, an org admin, or a system admin", () => {
  const classroom = { teacherId: "t1", orgId: "o1" };
  // The classroom's own teacher.
  assert.ok(cls.canManageClassroom({ id: "t1", role: "Reader" }, classroom, { role: "Student" }));
  // An org admin (org.manage) who isn't the teacher.
  assert.ok(cls.canManageClassroom({ id: "z", role: "Reader" }, classroom, { role: "OrgAdmin" }));
  // A system admin.
  assert.ok(cls.canManageClassroom({ id: "z", role: "Admin" }, classroom, null));
  // A plain teacher-role member who isn't this classroom's teacher cannot.
  assert.ok(!cls.canManageClassroom({ id: "z", role: "Reader" }, classroom, { role: "Teacher" }));
  // No classroom ⇒ never.
  assert.ok(!cls.canManageClassroom({ id: "t1", role: "Reader" }, null, { role: "OrgAdmin" }));
});

// ---------------------------------------------------------------------------
// recordAssignmentCompletion
// ---------------------------------------------------------------------------

test("recordAssignmentCompletion clamps the quiz score to 0–100", async () => {
  await cls.recordAssignmentCompletion("a1", "s1", { status: AssignmentStatus.COMPLETED, quizScore: 150 });
  assert.equal(lastUpsert!.update.quizScore, 100);
  assert.equal(lastUpsert!.create.quizScore, 100);

  await cls.recordAssignmentCompletion("a1", "s1", { status: AssignmentStatus.COMPLETED, quizScore: -5 });
  assert.equal(lastUpsert!.update.quizScore, 0);
});

test("recordAssignmentCompletion stamps completedAt only when COMPLETED", async () => {
  await cls.recordAssignmentCompletion("a1", "s1", { status: AssignmentStatus.COMPLETED });
  assert.ok(lastUpsert!.create.completedAt instanceof Date);

  await cls.recordAssignmentCompletion("a1", "s1", { status: AssignmentStatus.IN_PROGRESS });
  assert.equal(lastUpsert!.create.completedAt, null);
});

test("recordAssignmentCompletion defaults to COMPLETED", async () => {
  await cls.recordAssignmentCompletion("a1", "s1");
  assert.equal(lastUpsert!.create.status, AssignmentStatus.COMPLETED);
  assert.ok(lastUpsert!.create.completedAt instanceof Date);
});

// ---------------------------------------------------------------------------
// getStudentAssignmentContext
// ---------------------------------------------------------------------------

test("getStudentAssignmentContext returns context only for an enrolled student", async () => {
  assignmentRow = { id: "a1", classroomId: "c1" };
  const ctx = await cls.getStudentAssignmentContext("a1", "s1");
  assert.deepEqual(ctx, { assignmentId: "a1", classroomId: "c1" });
});

test("getStudentAssignmentContext returns null when not enrolled / missing", async () => {
  assignmentRow = null;
  const ctx = await cls.getStudentAssignmentContext("a1", "stranger");
  assert.equal(ctx, null);
});
