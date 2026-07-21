/**
 * PostgreSQL integration tests for the reading→assignment lifecycle:
 * syncAssignmentReadingProgress, markAssignmentQuizComplete, and
 * listStudentAssignmentsForArticle exercised against a real PostgreSQL database.
 *
 * Covers: sub-start short-circuit, mid-read IN_PROGRESS, complete-read COMPLETED
 * (both percent-based and completed:true paths), monotonic no-downgrade, quiz
 * precedence, multi-classroom fan-out, archived-classroom exclusion, and
 * non-enrolled student isolation.
 *
 * Guarded by `enabled` (RUN_DB_INTEGRATION=1) + a PostgreSQL DATABASE_URL.
 * Skips cleanly under plain `npm test`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { AssignmentStatus } from "@prisma/client";

import {
  ASSIGNMENT_START_PERCENT,
  markAssignmentQuizComplete,
  syncAssignmentReadingProgress,
} from "@/lib/classroom/completions";
import { listStudentAssignmentsForArticle } from "@/lib/classroom/student-reads";
import { prisma } from "@/lib/prisma";

import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

const POSTGRES_REQUIRED = "test:db requires a PostgreSQL DATABASE_URL";

function requirePostgres(): void {
  assert.equal(isPostgres, true, POSTGRES_REQUIRED);
}

/** Just below the start threshold (ASSIGNMENT_START_PERCENT = 1). */
const BELOW_START = ASSIGNMENT_START_PERCENT - 1; // 0

/** Above start, well below the complete threshold (95). */
const MID_PERCENT = 50;

/**
 * At the completion threshold; isCompletePercent(COMPLETE_PERCENT) === true.
 * COMPLETION_THRESHOLD = 95 from src/lib/engagement/progress-rules.ts.
 */
const COMPLETE_PERCENT = 95;

// ---------------------------------------------------------------------------
// Shared row-creation helpers
// ---------------------------------------------------------------------------

async function createOrg(orgId: string): Promise<void> {
  await prisma.organization.create({ data: { id: orgId, name: orgId, slug: orgId } });
}

async function createUser(userId: string, name: string): Promise<void> {
  await prisma.user.create({ data: { id: userId, name, role: "Reader" } });
}

async function createArticle(articleId: string): Promise<void> {
  await prisma.article.create({ data: { id: articleId, title: articleId, content: "Body" } });
}

async function createClassroom(
  classroomId: string,
  orgId: string,
  teacherId: string,
  archivedAt: Date | null = null,
): Promise<void> {
  await prisma.classroom.create({
    data: { id: classroomId, orgId, name: classroomId, teacherId, archivedAt },
  });
}

async function enrollStudent(classroomId: string, userId: string): Promise<void> {
  await prisma.classroomMembership.create({ data: { classroomId, userId } });
}

async function assignArticle(classroomId: string, articleId: string): Promise<string> {
  const assignment = await prisma.assignment.create({ data: { classroomId, articleId } });
  return assignment.id;
}

// ---------------------------------------------------------------------------
// Scenario a: sub-start read → no row created
// ---------------------------------------------------------------------------

test("sub-start read (percent < ASSIGNMENT_START_PERCENT) creates no AssignmentCompletion row", { skip: !enabled }, async () => {
  requirePostgres();

  const orgId = id("substart_org");
  const teacherId = id("substart_teacher");
  const studentId = id("substart_student");
  const articleId = id("substart_article");
  const classroomId = id("substart_classroom");

  await createOrg(orgId);
  await createUser(teacherId, "SubStart Teacher");
  await createUser(studentId, "SubStart Student");
  await createArticle(articleId);
  await createClassroom(classroomId, orgId, teacherId);
  await enrollStudent(classroomId, studentId);
  const assignmentId = await assignArticle(classroomId, articleId);

  const result = await syncAssignmentReadingProgress({
    userId: studentId,
    articleId,
    percent: BELOW_START,
    completed: false,
  });

  assert.equal(result.updatedCount, 0, "sub-start read must short-circuit with no DB write");
  const row = await prisma.assignmentCompletion.findUnique({
    where: { assignmentId_studentId: { assignmentId, studentId } },
  });
  assert.equal(row, null, "no completion row should be created for a sub-start read");
});

// ---------------------------------------------------------------------------
// Scenario b: mid read → IN_PROGRESS, completedAt null
// ---------------------------------------------------------------------------

test("mid read (≥ start, < complete) creates IN_PROGRESS completion with null completedAt", { skip: !enabled }, async () => {
  requirePostgres();

  const orgId = id("mid_org");
  const teacherId = id("mid_teacher");
  const studentId = id("mid_student");
  const articleId = id("mid_article");
  const classroomId = id("mid_classroom");

  await createOrg(orgId);
  await createUser(teacherId, "Mid Teacher");
  await createUser(studentId, "Mid Student");
  await createArticle(articleId);
  await createClassroom(classroomId, orgId, teacherId);
  await enrollStudent(classroomId, studentId);
  const assignmentId = await assignArticle(classroomId, articleId);

  const result = await syncAssignmentReadingProgress({
    userId: studentId,
    articleId,
    percent: MID_PERCENT,
    completed: false,
  });

  assert.equal(result.updatedCount, 1);
  const row = await prisma.assignmentCompletion.findUnique({
    where: { assignmentId_studentId: { assignmentId, studentId } },
  });
  assert.ok(row, "completion row must exist after mid read");
  assert.equal(row.status, AssignmentStatus.IN_PROGRESS);
  assert.equal(row.completedAt, null, "completedAt must be null for IN_PROGRESS");
  assert.equal(row.quizScore, null, "quizScore must be null (not set by reading)");

  // listStudentAssignmentsForArticle must reflect the persisted status.
  const [studentAssignment] = await listStudentAssignmentsForArticle(studentId, articleId);
  assert.ok(studentAssignment);
  assert.equal(studentAssignment.status, AssignmentStatus.IN_PROGRESS);
});

// ---------------------------------------------------------------------------
// Scenario c (part 1): complete read via isCompletePercent → COMPLETED + completedAt
// ---------------------------------------------------------------------------

test("complete read via isCompletePercent sets COMPLETED with completedAt", { skip: !enabled }, async () => {
  requirePostgres();

  const orgId = id("cmplt_org");
  const teacherId = id("cmplt_teacher");
  const studentId = id("cmplt_student");
  const articleId = id("cmplt_article");
  const classroomId = id("cmplt_classroom");

  await createOrg(orgId);
  await createUser(teacherId, "Complete Teacher");
  await createUser(studentId, "Complete Student");
  await createArticle(articleId);
  await createClassroom(classroomId, orgId, teacherId);
  await enrollStudent(classroomId, studentId);
  const assignmentId = await assignArticle(classroomId, articleId);

  const result = await syncAssignmentReadingProgress({
    userId: studentId,
    articleId,
    percent: COMPLETE_PERCENT,
    completed: false,
  });

  assert.equal(result.updatedCount, 1);
  const row = await prisma.assignmentCompletion.findUnique({
    where: { assignmentId_studentId: { assignmentId, studentId } },
  });
  assert.ok(row);
  assert.equal(row.status, AssignmentStatus.COMPLETED);
  assert.ok(row.completedAt instanceof Date, "completedAt must be set on reading completion");
  assert.equal(row.quizScore, null, "quizScore must not be set by reading sync");

  const [studentAssignment] = await listStudentAssignmentsForArticle(studentId, articleId);
  assert.equal(studentAssignment.status, AssignmentStatus.COMPLETED);
  assert.ok(studentAssignment.completedAt);
});

// ---------------------------------------------------------------------------
// Scenario c (part 2): complete read via completed:true → COMPLETED + completedAt
// ---------------------------------------------------------------------------

test("complete read via completed:true sets COMPLETED even at mid percent", { skip: !enabled }, async () => {
  requirePostgres();

  const orgId = id("ctrue_org");
  const teacherId = id("ctrue_teacher");
  const studentId = id("ctrue_student");
  const articleId = id("ctrue_article");
  const classroomId = id("ctrue_classroom");

  await createOrg(orgId);
  await createUser(teacherId, "CTrue Teacher");
  await createUser(studentId, "CTrue Student");
  await createArticle(articleId);
  await createClassroom(classroomId, orgId, teacherId);
  await enrollStudent(classroomId, studentId);
  const assignmentId = await assignArticle(classroomId, articleId);

  // percent is below the completion threshold but completed:true overrides it.
  const result = await syncAssignmentReadingProgress({
    userId: studentId,
    articleId,
    percent: MID_PERCENT,
    completed: true,
  });

  assert.equal(result.updatedCount, 1);
  const row = await prisma.assignmentCompletion.findUnique({
    where: { assignmentId_studentId: { assignmentId, studentId } },
  });
  assert.ok(row);
  assert.equal(row.status, AssignmentStatus.COMPLETED, "completed:true must yield COMPLETED");
  assert.ok(row.completedAt instanceof Date, "completedAt must be set when completed:true");
});

// ---------------------------------------------------------------------------
// Scenario d: monotonic — COMPLETED is never downgraded by a later read
// ---------------------------------------------------------------------------

test("monotonic: status never downgrades from COMPLETED after sub-threshold or mid read", { skip: !enabled }, async () => {
  requirePostgres();

  const orgId = id("mono_org");
  const teacherId = id("mono_teacher");
  const studentId = id("mono_student");
  const articleId = id("mono_article");
  const classroomId = id("mono_classroom");

  await createOrg(orgId);
  await createUser(teacherId, "Mono Teacher");
  await createUser(studentId, "Mono Student");
  await createArticle(articleId);
  await createClassroom(classroomId, orgId, teacherId);
  await enrollStudent(classroomId, studentId);
  const assignmentId = await assignArticle(classroomId, articleId);

  // Drive to COMPLETED first.
  await syncAssignmentReadingProgress({
    userId: studentId,
    articleId,
    percent: COMPLETE_PERCENT,
    completed: false,
  });

  const completedRow = await prisma.assignmentCompletion.findUnique({
    where: { assignmentId_studentId: { assignmentId, studentId } },
  });
  assert.ok(completedRow?.completedAt, "completedAt must be set after initial COMPLETED write");
  const originalCompletedAt = completedRow.completedAt;

  // Sub-threshold read must short-circuit entirely.
  const subResult = await syncAssignmentReadingProgress({
    userId: studentId,
    articleId,
    percent: BELOW_START,
    completed: false,
  });
  assert.equal(subResult.updatedCount, 0, "sub-start read after COMPLETED must short-circuit");

  // Mid read must be rejected by the monotonic rank guard.
  const midResult = await syncAssignmentReadingProgress({
    userId: studentId,
    articleId,
    percent: MID_PERCENT,
    completed: false,
  });
  assert.equal(midResult.updatedCount, 0, "mid read after COMPLETED must not write");

  const finalRow = await prisma.assignmentCompletion.findUnique({
    where: { assignmentId_studentId: { assignmentId, studentId } },
  });
  assert.ok(finalRow);
  assert.equal(finalRow.status, AssignmentStatus.COMPLETED, "status must remain COMPLETED");
  assert.deepEqual(finalRow.completedAt, originalCompletedAt, "completedAt must be sticky — never overwritten");
});

// ---------------------------------------------------------------------------
// Scenario e: quiz precedence — reading sync never clears quizScore or downgrades
// ---------------------------------------------------------------------------

test("quiz precedence: reading sync after markAssignmentQuizComplete does not clear quizScore or downgrade", { skip: !enabled }, async () => {
  requirePostgres();

  const orgId = id("quiz_org");
  const teacherId = id("quiz_teacher");
  const studentId = id("quiz_student");
  const articleId = id("quiz_article");
  const classroomId = id("quiz_classroom");

  await createOrg(orgId);
  await createUser(teacherId, "Quiz Teacher");
  await createUser(studentId, "Quiz Student");
  await createArticle(articleId);
  await createClassroom(classroomId, orgId, teacherId);
  await enrollStudent(classroomId, studentId);
  const assignmentId = await assignArticle(classroomId, articleId);

  // Quiz sets COMPLETED + quizScore.
  const { completedCount } = await markAssignmentQuizComplete({
    userId: studentId,
    articleId,
    scorePct: 80,
  });
  assert.equal(completedCount, 1);

  const afterQuiz = await prisma.assignmentCompletion.findUnique({
    where: { assignmentId_studentId: { assignmentId, studentId } },
  });
  assert.ok(afterQuiz);
  assert.equal(afterQuiz.status, AssignmentStatus.COMPLETED);
  assert.equal(afterQuiz.quizScore, 80);
  assert.ok(afterQuiz.completedAt);

  // Later mid-read must not overwrite or downgrade.
  const syncResult = await syncAssignmentReadingProgress({
    userId: studentId,
    articleId,
    percent: MID_PERCENT,
    completed: false,
  });
  assert.equal(syncResult.updatedCount, 0, "reading sync must not overwrite a quiz-completed row");

  const afterSync = await prisma.assignmentCompletion.findUnique({
    where: { assignmentId_studentId: { assignmentId, studentId } },
  });
  assert.ok(afterSync);
  assert.equal(afterSync.status, AssignmentStatus.COMPLETED, "status must remain COMPLETED after reading sync");
  assert.equal(afterSync.quizScore, 80, "quizScore must not be cleared by reading sync");
  assert.ok(afterSync.completedAt, "completedAt must remain set after reading sync");
});

// ---------------------------------------------------------------------------
// Scenario f: multi-classroom fan-out — both classrooms advance
// ---------------------------------------------------------------------------

test("multi-classroom fan-out: reading advances completions in all enrolled classrooms", { skip: !enabled }, async () => {
  requirePostgres();

  const orgId = id("fanout_org");
  const teacherId = id("fanout_teacher");
  const studentId = id("fanout_student");
  const articleId = id("fanout_article");
  const classroomAId = id("fanout_classroomA");
  const classroomBId = id("fanout_classroomB");

  await createOrg(orgId);
  await createUser(teacherId, "Fanout Teacher");
  await createUser(studentId, "Fanout Student");
  await createArticle(articleId);
  await createClassroom(classroomAId, orgId, teacherId);
  await createClassroom(classroomBId, orgId, teacherId);
  await enrollStudent(classroomAId, studentId);
  await enrollStudent(classroomBId, studentId);
  const assignmentAId = await assignArticle(classroomAId, articleId);
  const assignmentBId = await assignArticle(classroomBId, articleId);

  const result = await syncAssignmentReadingProgress({
    userId: studentId,
    articleId,
    percent: MID_PERCENT,
    completed: false,
  });
  assert.equal(result.updatedCount, 2, "both assignments must be advanced");

  const [rowA, rowB] = await Promise.all([
    prisma.assignmentCompletion.findUnique({
      where: { assignmentId_studentId: { assignmentId: assignmentAId, studentId } },
    }),
    prisma.assignmentCompletion.findUnique({
      where: { assignmentId_studentId: { assignmentId: assignmentBId, studentId } },
    }),
  ]);
  assert.equal(rowA?.status, AssignmentStatus.IN_PROGRESS, "classroom A must be IN_PROGRESS");
  assert.equal(rowB?.status, AssignmentStatus.IN_PROGRESS, "classroom B must be IN_PROGRESS");

  // listStudentAssignmentsForArticle must return both rows.
  const studentAssignments = await listStudentAssignmentsForArticle(studentId, articleId);
  assert.equal(studentAssignments.length, 2, "must return assignments from both classrooms");
  assert.ok(
    studentAssignments.every((a) => a.status === AssignmentStatus.IN_PROGRESS),
    "both student assignment rows must be IN_PROGRESS",
  );
});

// ---------------------------------------------------------------------------
// Scenario g: archived classroom — assignment NOT advanced
// ---------------------------------------------------------------------------

test("archived classroom: reading sync does not advance assignments in archived classrooms", { skip: !enabled }, async () => {
  requirePostgres();

  const orgId = id("archive_org");
  const teacherId = id("archive_teacher");
  const studentId = id("archive_student");
  const articleId = id("archive_article");
  const classroomId = id("archive_classroom");

  await createOrg(orgId);
  await createUser(teacherId, "Archive Teacher");
  await createUser(studentId, "Archive Student");
  await createArticle(articleId);
  // Classroom is archived (archivedAt is non-null).
  await createClassroom(classroomId, orgId, teacherId, new Date("2024-01-01T00:00:00.000Z"));
  await enrollStudent(classroomId, studentId);
  const assignmentId = await assignArticle(classroomId, articleId);

  const result = await syncAssignmentReadingProgress({
    userId: studentId,
    articleId,
    percent: MID_PERCENT,
    completed: false,
  });
  assert.equal(result.updatedCount, 0, "archived classroom must be excluded from reading sync");

  const row = await prisma.assignmentCompletion.findUnique({
    where: { assignmentId_studentId: { assignmentId, studentId } },
  });
  assert.equal(row, null, "no completion row should be created for an archived classroom");
});

// ---------------------------------------------------------------------------
// Scenario h: non-enrolled student — no completion created
// ---------------------------------------------------------------------------

test("non-enrolled student: reading creates no completion for a student not in the classroom", { skip: !enabled }, async () => {
  requirePostgres();

  const orgId = id("nonenr_org");
  const teacherId = id("nonenr_teacher");
  const enrolledId = id("nonenr_enrolled");
  const outsiderId = id("nonenr_outsider");
  const articleId = id("nonenr_article");
  const classroomId = id("nonenr_classroom");

  await createOrg(orgId);
  await createUser(teacherId, "NonEnr Teacher");
  await createUser(enrolledId, "NonEnr Enrolled");
  await createUser(outsiderId, "NonEnr Outsider");
  await createArticle(articleId);
  await createClassroom(classroomId, orgId, teacherId);
  // Only the enrolled student is a classroom member; the outsider is not.
  await enrollStudent(classroomId, enrolledId);
  const assignmentId = await assignArticle(classroomId, articleId);

  const result = await syncAssignmentReadingProgress({
    userId: outsiderId,
    articleId,
    percent: MID_PERCENT,
    completed: false,
  });
  assert.equal(result.updatedCount, 0, "non-enrolled student must produce no completion update");

  const row = await prisma.assignmentCompletion.findUnique({
    where: { assignmentId_studentId: { assignmentId, studentId: outsiderId } },
  });
  assert.equal(row, null, "no completion row should exist for a non-enrolled student");
});
