/**
 * PostgreSQL integration tests for multi-tenant models:
 * Organization, Membership, Classroom, Assignment, AssignmentCompletion.
 *
 * Covers: Membership unique-constraint rejection, Organization→Membership cascade
 * delete, AssignmentCompletion upsert idempotency, and
 * Classroom→Assignment/AssignmentCompletion cascade.
 *
 * Guarded by `enabled` (RUN_DB_INTEGRATION=1) + a PostgreSQL DATABASE_URL.
 * Skips cleanly under plain `npm test`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { AssignmentStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { removeClassroomMember } from "@/lib/classroom/commands";
import { countPendingAssignmentsForStudent, listAssignmentsForTeacher } from "@/lib/classroom/queries";
import { reviewAssignmentCompletion } from "@/lib/classroom/completions";
import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

const POSTGRES_REQUIRED = "test:db requires a PostgreSQL DATABASE_URL";
const DUPLICATE_KEY_ERROR = /Unique constraint failed|Unique constraint|duplicate key value/;

function requirePostgres(): void {
  assert.equal(isPostgres, true, POSTGRES_REQUIRED);
}

async function createReader(userId: string, name: string): Promise<void> {
  await prisma.user.create({ data: { id: userId, name, role: "Reader" } });
}

async function createOrganization(orgId: string, name: string): Promise<void> {
  await prisma.organization.create({ data: { id: orgId, name, slug: orgId } });
}

async function createArticle(articleId: string, title: string, content: string): Promise<void> {
  await prisma.article.create({ data: { id: articleId, title, content } });
}

test("Membership unique constraint rejects duplicate (userId, orgId) pair", { skip: !enabled }, async () => {
  requirePostgres();

  const userId = id("mc_user");
  const orgId = id("mc_org");

  await createReader(userId, "MC User");
  await createOrganization(orgId, "MC Org");
  await prisma.membership.create({ data: { userId, orgId } });

  await assert.rejects(
    prisma.membership.create({ data: { userId, orgId } }),
    DUPLICATE_KEY_ERROR,
  );
});

test("Organization delete cascades to Membership rows", { skip: !enabled }, async () => {
  requirePostgres();

  const userId = id("orgcasc_user");
  const orgId = id("orgcasc_org");

  await createReader(userId, "Org Cascade User");
  await createOrganization(orgId, "Cascade Org");
  await prisma.membership.create({ data: { userId, orgId } });

  assert.equal(await prisma.membership.count({ where: { orgId } }), 1);

  await prisma.organization.delete({ where: { id: orgId } });

  assert.equal(await prisma.membership.count({ where: { orgId } }), 0);
});

test("AssignmentCompletion upsert is idempotent — second call updates, does not duplicate", { skip: !enabled }, async () => {
  requirePostgres();

  const teacherId = id("upsert_teacher");
  const studentId = id("upsert_student");
  const orgId = id("upsert_org");
  const articleId = id("upsert_article");
  const classroomId = id("upsert_classroom");

  await prisma.user.createMany({
    data: [
      { id: teacherId, name: "Upsert Teacher", role: "Reader" },
      { id: studentId, name: "Upsert Student", role: "Reader" },
    ],
  });
  await createOrganization(orgId, "Upsert Org");
  await createArticle(articleId, "Upsert Article", "Body for upsert test");
  await prisma.classroom.create({
    data: { id: classroomId, orgId, name: "Upsert Classroom", teacherId },
  });
  const assignment = await prisma.assignment.create({
    data: { classroomId, articleId },
  });
  const completionKey = { assignmentId_studentId: { assignmentId: assignment.id, studentId } };
  const assignedCompletion = {
    assignmentId: assignment.id,
    studentId,
    status: AssignmentStatus.ASSIGNED,
  };

  // First upsert — creates the row.
  await prisma.assignmentCompletion.upsert({
    where: completionKey,
    create: assignedCompletion,
    update: { status: AssignmentStatus.IN_PROGRESS },
  });

  // Second upsert — updates the existing row.
  const updated = await prisma.assignmentCompletion.upsert({
    where: completionKey,
    create: assignedCompletion,
    update: { status: AssignmentStatus.COMPLETED },
  });

  assert.equal(updated.status, AssignmentStatus.COMPLETED);
  assert.equal(
    await prisma.assignmentCompletion.count({ where: { assignmentId: assignment.id } }),
    1,
    "upsert must not create a second row",
  );
});

test("Classroom delete cascades to Assignment and AssignmentCompletion", { skip: !enabled }, async () => {
  requirePostgres();

  const teacherId = id("clcasc_teacher");
  const studentId = id("clcasc_student");
  const orgId = id("clcasc_org");
  const articleId = id("clcasc_article");
  const classroomId = id("clcasc_classroom");

  await prisma.user.createMany({
    data: [
      { id: teacherId, name: "CL Cascade Teacher", role: "Reader" },
      { id: studentId, name: "CL Cascade Student", role: "Reader" },
    ],
  });
  await createOrganization(orgId, "CL Cascade Org");
  await createArticle(articleId, "CL Cascade Article", "Body for cascade test");
  await prisma.classroom.create({
    data: { id: classroomId, orgId, name: "CL Cascade Classroom", teacherId },
  });
  const assignment = await prisma.assignment.create({
    data: { classroomId, articleId },
  });
  await prisma.assignmentCompletion.create({
    data: { assignmentId: assignment.id, studentId, status: AssignmentStatus.ASSIGNED },
  });

  assert.equal(await prisma.assignment.count({ where: { classroomId } }), 1);
  assert.equal(
    await prisma.assignmentCompletion.count({ where: { assignmentId: assignment.id } }),
    1,
  );

  await prisma.classroom.delete({ where: { id: classroomId } });

  assert.equal(
    await prisma.assignment.count({ where: { classroomId } }),
    0,
    "assignments should be deleted on classroom cascade",
  );
  assert.equal(
    await prisma.assignmentCompletion.count({ where: { assignmentId: assignment.id } }),
    0,
    "completions should be deleted on assignment cascade",
  );
});

test("removeClassroomMember deletes membership AND student completions for that classroom", { skip: !enabled }, async () => {
  requirePostgres();

  const teacherId = id("rmcm_teacher");
  const studentId = id("rmcm_student");
  const orgId = id("rmcm_org");
  const articleId = id("rmcm_article");
  const classroomId = id("rmcm_classroom");

  await prisma.user.createMany({
    data: [
      { id: teacherId, name: "RMCM Teacher", role: "Reader" },
      { id: studentId, name: "RMCM Student", role: "Reader" },
    ],
  });
  await createOrganization(orgId, "RMCM Org");
  await createArticle(articleId, "RMCM Article", "Body for removeClassroomMember test");
  await prisma.classroom.create({
    data: { id: classroomId, orgId, name: "RMCM Classroom", teacherId },
  });
  const assignment = await prisma.assignment.create({
    data: { classroomId, articleId },
  });
  await prisma.classroomMembership.create({
    data: { classroomId, userId: studentId, role: "Student" },
  });
  await prisma.assignmentCompletion.create({
    data: { assignmentId: assignment.id, studentId, status: AssignmentStatus.ASSIGNED },
  });

  assert.equal(
    await prisma.classroomMembership.count({ where: { classroomId, userId: studentId } }),
    1,
  );
  assert.equal(
    await prisma.assignmentCompletion.count({ where: { studentId, assignmentId: assignment.id } }),
    1,
  );

  await removeClassroomMember(classroomId, studentId);

  assert.equal(
    await prisma.classroomMembership.count({ where: { classroomId, userId: studentId } }),
    0,
    "membership must be deleted",
  );
  assert.equal(
    await prisma.assignmentCompletion.count({ where: { studentId, assignmentId: assignment.id } }),
    0,
    "completions must be deleted",
  );
});

test("countPendingAssignmentsForStudent counts ASSIGNED+IN_PROGRESS but not COMPLETED; excludes archived classrooms", { skip: !enabled }, async () => {
  requirePostgres();

  const teacherId = id("pab_teacher");
  const studentId = id("pab_student");
  const orgId = id("pab_org");
  const classroomId = id("pab_classroom");
  const archivedClassroomId = id("pab_archived_classroom");
  const articleId1 = id("pab_article1");
  const articleId2 = id("pab_article2");
  const articleId3 = id("pab_article3");
  const articleId4 = id("pab_article4");

  await prisma.user.createMany({
    data: [
      { id: teacherId, name: "PAB Teacher", role: "Reader" },
      { id: studentId, name: "PAB Student", role: "Reader" },
    ],
  });
  await prisma.organization.create({ data: { id: orgId, name: "PAB Org", slug: orgId } });
  await prisma.article.createMany({
    data: [
      { id: articleId1, title: "PAB Article 1", content: "body" },
      { id: articleId2, title: "PAB Article 2", content: "body" },
      { id: articleId3, title: "PAB Article 3", content: "body" },
      { id: articleId4, title: "PAB Article 4 (archived)", content: "body" },
    ],
  });

  // Active classroom with student membership.
  await prisma.classroom.create({
    data: { id: classroomId, orgId, name: "PAB Active Classroom", teacherId },
  });
  await prisma.classroomMembership.create({
    data: { classroomId, userId: studentId, role: "Student" },
  });

  // 3 assignments in the active classroom.
  const a1 = await prisma.assignment.create({ data: { classroomId, articleId: articleId1 } });
  const a2 = await prisma.assignment.create({ data: { classroomId, articleId: articleId2 } });
  const a3 = await prisma.assignment.create({ data: { classroomId, articleId: articleId3 } });

  // a1: COMPLETED — must NOT count.
  await prisma.assignmentCompletion.create({
    data: { assignmentId: a1.id, studentId, status: AssignmentStatus.COMPLETED },
  });
  // a2: IN_PROGRESS — must count (not COMPLETED).
  await prisma.assignmentCompletion.create({
    data: { assignmentId: a2.id, studentId, status: AssignmentStatus.IN_PROGRESS },
  });
  // a3: no completion row (ASSIGNED default) — must count.

  // Archived classroom — its assignments must NOT count even without completions.
  await prisma.classroom.create({
    data: {
      id: archivedClassroomId,
      orgId,
      name: "PAB Archived Classroom",
      teacherId,
      archivedAt: new Date(),
    },
  });
  await prisma.classroomMembership.create({
    data: { classroomId: archivedClassroomId, userId: studentId, role: "Student" },
  });
  await prisma.assignment.create({
    data: { classroomId: archivedClassroomId, articleId: articleId4 },
  });

  const count = await countPendingAssignmentsForStudent(studentId);
  assert.equal(count, 2, "should count IN_PROGRESS + no-completion rows, not COMPLETED or archived");
});

test("reviewAssignmentCompletion persists feedback, reviewedAt, and reviewedBy", { skip: !enabled }, async () => {
  requirePostgres();

  const teacherId = id("rac_teacher");
  const studentId = id("rac_student");
  const orgId = id("rac_org");
  const articleId = id("rac_article");
  const classroomId = id("rac_classroom");

  await prisma.user.createMany({
    data: [
      { id: teacherId, name: "RAC Teacher", role: "Reader" },
      { id: studentId, name: "RAC Student", role: "Reader" },
    ],
  });
  await createOrganization(orgId, "RAC Org");
  await createArticle(articleId, "RAC Article", "Body for review feedback test");
  await prisma.classroom.create({
    data: { id: classroomId, orgId, name: "RAC Classroom", teacherId },
  });
  await prisma.classroomMembership.create({
    data: { classroomId, userId: studentId, role: "Student" },
  });
  const assignment = await prisma.assignment.create({
    data: { classroomId, articleId },
  });

  await reviewAssignmentCompletion(assignment.id, studentId, {
    feedback: "Great work",
    reviewedBy: teacherId,
  });

  const completion = await prisma.assignmentCompletion.findUnique({
    where: { assignmentId_studentId: { assignmentId: assignment.id, studentId } },
  });

  assert.ok(completion, "completion row must exist");
  assert.equal(completion.feedback, "Great work");
  assert.equal(completion.reviewedBy, teacherId);
  assert.ok(completion.reviewedAt instanceof Date, "reviewedAt must be a Date");
});

test("listAssignmentsForTeacher returns assignments from both classrooms with correct counts", { skip: !enabled }, async () => {
  requirePostgres();

  const teacherId = id("laft_teacher");
  const studentId = id("laft_student");
  const orgId = id("laft_org");
  const classroomId1 = id("laft_classroom1");
  const classroomId2 = id("laft_classroom2");
  const articleId1 = id("laft_article1");
  const articleId2 = id("laft_article2");

  await prisma.user.createMany({
    data: [
      { id: teacherId, name: "LAFT Teacher", role: "Reader" },
      { id: studentId, name: "LAFT Student", role: "Reader" },
    ],
  });
  await createOrganization(orgId, "LAFT Org");
  await createArticle(articleId1, "LAFT Article 1", "body");
  await createArticle(articleId2, "LAFT Article 2", "body");

  // Classroom 1: teacher is primary teacherId, 1 student enrolled.
  await prisma.classroom.create({
    data: { id: classroomId1, orgId, name: "LAFT Classroom 1", teacherId },
  });
  await prisma.classroomMembership.create({
    data: { classroomId: classroomId1, userId: studentId, role: "Student" },
  });
  const a1 = await prisma.assignment.create({ data: { classroomId: classroomId1, articleId: articleId1, dueDate: new Date("2026-08-01") } });

  // Student completes the assignment in classroom 1.
  await prisma.assignmentCompletion.create({
    data: { assignmentId: a1.id, studentId, status: AssignmentStatus.COMPLETED },
  });

  // Classroom 2: teacher is a Teacher member (not primary teacherId).
  const otherTeacherId = id("laft_other_teacher");
  await prisma.user.create({ data: { id: otherTeacherId, name: "LAFT Other Teacher", role: "Reader" } });
  await prisma.classroom.create({
    data: { id: classroomId2, orgId, name: "LAFT Classroom 2", teacherId: otherTeacherId },
  });
  await prisma.classroomMembership.create({
    data: { classroomId: classroomId2, userId: teacherId, role: "Teacher" },
  });
  await prisma.classroomMembership.create({
    data: { classroomId: classroomId2, userId: studentId, role: "Student" },
  });
  await prisma.assignment.create({ data: { classroomId: classroomId2, articleId: articleId2 } });

  const rows = await listAssignmentsForTeacher(teacherId);

  // Should return assignments from both classrooms.
  const classroomIds = rows.map((r) => r.classroomId);
  assert.ok(classroomIds.includes(classroomId1), "must include classroom 1");
  assert.ok(classroomIds.includes(classroomId2), "must include classroom 2");

  // Classroom 1 assignment: 1 completed, 1 student enrolled.
  const row1 = rows.find((r) => r.classroomId === classroomId1);
  assert.ok(row1, "row for classroom 1 must exist");
  assert.equal(row1.completedCount, 1, "completedCount must be 1");
  assert.equal(row1.studentCount, 1, "studentCount must be 1");

  // Classroom 2 assignment: 0 completed, 1 student enrolled.
  const row2 = rows.find((r) => r.classroomId === classroomId2);
  assert.ok(row2, "row for classroom 2 must exist");
  assert.equal(row2.completedCount, 0, "completedCount must be 0");
  assert.equal(row2.studentCount, 1, "studentCount must be 1");
});

