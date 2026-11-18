/**
 * PostgreSQL integration tests for Write Prompt responses (#1305).
 *
 * Covers prompt resolution (assignment → article default → generic) and
 * snapshotting, draft autosave, submit / lock / revise / resubmit, the
 * independent-writing privacy boundary, teacher listing without drafts,
 * cross-classroom IDOR, review rules, audit rows, and cascades.
 *
 * Guarded by `enabled` (RUN_DB_INTEGRATION=1) + a PostgreSQL DATABASE_URL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ArticleStatus, ArticleVisibility, WriteSubmissionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getArticleWritePrompt,
  getWriteContext,
  listAssignmentSubmissions,
  reviewWriteSubmission,
  saveWriteDraft,
  submitWriteResponse,
} from "@/lib/classroom/writing";
import { defaultWritePrompt } from "@/lib/classroom/writing-rubric";
import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

type Viewer = { id: string; role: string };

function requirePostgres(): void {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");
}

function audit(actorId: string, targetId?: string) {
  return ({ action, metadata }: { action: string; metadata: Record<string, unknown> }) => ({
    req: new Request("http://test/api/write-submissions/x/review"),
    session: { user: { id: actorId, role: "Reader" }, expires: "2099-01-01" },
    action,
    targetType: "write_submission",
    targetId,
    metadata,
  }) as never;
}

async function setup(label: string) {
  const orgId = id(`${label}_org`);
  const otherOrgId = id(`${label}_org2`);
  const [teacher, student, otherStudent, otherTeacher] = [
    { id: id(`${label}_teacher`), role: "Reader" },
    { id: id(`${label}_student`), role: "Reader" },
    { id: id(`${label}_student2`), role: "Reader" },
    { id: id(`${label}_teacher2`), role: "Reader" },
  ] satisfies Viewer[];
  await prisma.user.createMany({
    data: [teacher, student, otherStudent, otherTeacher].map((u) => ({ id: u.id, name: u.id, role: "Reader" as const })),
  });
  await prisma.organization.createMany({
    data: [
      { id: orgId, name: "Org", slug: orgId },
      { id: otherOrgId, name: "Other", slug: otherOrgId },
    ],
  });
  await prisma.membership.createMany({
    data: [
      { userId: teacher.id, orgId, role: "Teacher" },
      { userId: student.id, orgId, role: "Student" },
      { userId: otherStudent.id, orgId, role: "Student" },
      { userId: otherTeacher.id, orgId: otherOrgId, role: "Teacher" },
    ],
  });
  const classroomId = id(`${label}_class`);
  const otherClassroomId = id(`${label}_class2`);
  await prisma.classroom.createMany({
    data: [
      { id: classroomId, orgId, name: "Period 1", teacherId: teacher.id },
      { id: otherClassroomId, orgId: otherOrgId, name: "Elsewhere", teacherId: otherTeacher.id },
    ],
  });
  await prisma.classroomMembership.createMany({
    data: [
      { classroomId, userId: student.id, role: "Student" as const },
      { classroomId, userId: otherStudent.id, role: "Student" as const },
    ],
  });
  const articleId = id(`${label}_article`);
  await prisma.article.create({
    data: { id: articleId, title: "Coral Reefs", content: "<p>x</p>", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PUBLIC },
  });
  const assignment = await prisma.assignment.create({
    data: { classroomId, articleId, writePrompt: "  Argue whether reefs can recover.  " },
  });
  return { teacher, student, otherStudent, otherTeacher, classroomId, otherClassroomId, articleId, assignmentId: assignment.id };
}

const article = (articleId: string) => ({ id: articleId, title: "Coral Reefs" });

test("prompts resolve from the assignment, then the article default, then the generic prompt", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("wr_prompt");

  const independent = await getWriteContext(s.student.id, article(s.articleId));
  assert.ok(independent.ok);
  assert.equal(independent.context.prompt, defaultWritePrompt("Coral Reefs"));
  assert.deepEqual(independent.context.assignments, [
    { id: s.assignmentId, classroomName: "Period 1", prompt: "Argue whether reefs can recover." },
  ]);
  assert.equal(independent.context.submission, null);

  await prisma.writePrompt.create({ data: { articleId: s.articleId, prompt: "Explain what threatens reefs." } });
  assert.equal(await getArticleWritePrompt(s.articleId), "Explain what threatens reefs.");
  const withDefault = await getWriteContext(s.student.id, article(s.articleId));
  assert.ok(withDefault.ok);
  assert.equal(withDefault.context.prompt, "Explain what threatens reefs.");

  await prisma.assignment.update({ where: { id: s.assignmentId }, data: { writePrompt: null } });
  const assignmentScope = await getWriteContext(s.student.id, article(s.articleId), s.assignmentId);
  assert.ok(assignmentScope.ok);
  assert.equal(assignmentScope.context.prompt, "Explain what threatens reefs.");

  // A response keeps the prompt it started with.
  await saveWriteDraft(s.student.id, article(s.articleId), { assignmentId: s.assignmentId, body: "Draft" });
  await prisma.assignment.update({ where: { id: s.assignmentId }, data: { writePrompt: "New prompt" } });
  const snapshot = await getWriteContext(s.student.id, article(s.articleId), s.assignmentId);
  assert.ok(snapshot.ok);
  assert.equal(snapshot.context.prompt, "Explain what threatens reefs.");

  // Assignments the learner isn't part of are not found.
  assert.deepEqual(await getWriteContext(s.otherTeacher.id, article(s.articleId), s.assignmentId), {
    ok: false,
    status: 404,
    reason: "not_found",
  });
  assert.equal(await getArticleWritePrompt("missing"), null);
});

test("drafts autosave, submission locks assignment work, and returned work is resubmitted", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("wr_flow");
  const scope = { assignmentId: s.assignmentId };

  const draft = await saveWriteDraft(s.student.id, article(s.articleId), { ...scope, body: "Reefs  can recover" });
  assert.ok(draft.ok);
  assert.equal(draft.submission.status, WriteSubmissionStatus.DRAFT);
  assert.equal(draft.submission.wordCount, 3);

  assert.deepEqual(await submitWriteResponse(s.student.id, article(s.articleId), { ...scope, body: "   " }), {
    ok: false,
    status: 400,
    reason: "empty_response",
  });
  const submitted = await submitWriteResponse(s.student.id, article(s.articleId), { ...scope, body: "Reefs can recover slowly." });
  assert.ok(submitted.ok);
  assert.equal(submitted.submission.status, WriteSubmissionStatus.SUBMITTED);
  assert.ok(submitted.submission.submittedAt);
  assert.deepEqual(await saveWriteDraft(s.student.id, article(s.articleId), { ...scope, body: "edit" }), {
    ok: false,
    status: 409,
    reason: "locked",
  });

  const returned = await reviewWriteSubmission(
    submitted.submission.id,
    s.teacher,
    { action: "return", rubricScores: { claim: 2, evidence: 1, bogus: 4 }, feedback: "  Add evidence.  " },
    audit(s.teacher.id, submitted.submission.id),
  );
  assert.ok(returned.ok);
  assert.equal(returned.submission.status, WriteSubmissionStatus.NEEDS_REVISION);
  assert.deepEqual(returned.submission.rubricScores, { claim: 2, evidence: 1 });
  assert.equal(returned.submission.teacherFeedback, "Add evidence.");
  assert.equal(returned.submission.gradedAt, null);

  const revising = await saveWriteDraft(s.student.id, article(s.articleId), { ...scope, body: "Revised with evidence." });
  assert.ok(revising.ok);
  assert.equal(revising.submission.status, WriteSubmissionStatus.NEEDS_REVISION, "revising keeps the returned state");
  const duringRevision = await listAssignmentSubmissions(s.assignmentId, s.teacher);
  assert.ok(duringRevision.ok);
  assert.deepEqual(
    duringRevision.submissions.map((row) => [row.status, row.body, row.wordCount]),
    [[WriteSubmissionStatus.NEEDS_REVISION, "", 0]],
    "in-progress revisions stay private",
  );
  const resubmitted = await submitWriteResponse(s.student.id, article(s.articleId), { ...scope, body: "Revised with evidence." });
  assert.ok(resubmitted.ok);
  assert.equal(resubmitted.submission.revisionCount, 1);

  const graded = await reviewWriteSubmission(
    resubmitted.submission.id,
    s.teacher,
    { action: "grade", rubricScores: { claim: 4, evidence: 3, organization: 3, language: 4 }, feedback: null },
    audit(s.teacher.id, submitted.submission.id),
  );
  assert.ok(graded.ok);
  assert.equal(graded.submission.status, WriteSubmissionStatus.GRADED);
  assert.ok(graded.submission.gradedAt);
  assert.equal(graded.submission.teacherFeedback, null);

  const audits = await prisma.auditLog.findMany({
    where: { targetId: submitted.submission.id },
    select: { action: true, metadata: true },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(audits.map((row) => row.action), ["write_submission.return", "write_submission.grade"]);
  assert.equal(audits.some((row) => JSON.stringify(row.metadata).includes("evidence.")), false, "no response or feedback text");
});

test("independent writing stays private and can be reopened", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("wr_private");
  const own = await submitWriteResponse(s.student.id, article(s.articleId), { body: "My private thoughts." });
  assert.ok(own.ok);
  assert.equal(own.submission.assignmentId, null);

  const reopened = await saveWriteDraft(s.student.id, article(s.articleId), { body: "Still thinking." });
  assert.ok(reopened.ok);
  assert.equal(reopened.submission.status, WriteSubmissionStatus.DRAFT);
  await submitWriteResponse(s.student.id, article(s.articleId), { body: "Final private thoughts." });

  const listing = await listAssignmentSubmissions(s.assignmentId, s.teacher);
  assert.ok(listing.ok);
  assert.deepEqual(listing.submissions, [], "independent writing never reaches the teacher");
  assert.deepEqual(
    await reviewWriteSubmission(own.submission.id, s.teacher, { action: "grade", rubricScores: {} }, audit(s.teacher.id)),
    { ok: false, status: 404, reason: "not_found" },
  );
});

test("teachers see submitted work only for classrooms they manage", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("wr_idor");
  const scope = { assignmentId: s.assignmentId };
  await saveWriteDraft(s.otherStudent.id, article(s.articleId), { ...scope, body: "Unsubmitted draft." });
  const submitted = await submitWriteResponse(s.student.id, article(s.articleId), { ...scope, body: "Submitted answer." });
  assert.ok(submitted.ok);

  const listing = await listAssignmentSubmissions(s.assignmentId, s.teacher);
  assert.ok(listing.ok);
  assert.equal(listing.assignment.classroomId, s.classroomId);
  assert.equal(listing.assignment.prompt, "Argue whether reefs can recover.");
  assert.deepEqual(listing.submissions.map((row) => row.student.id), [s.student.id], "drafts are excluded");

  for (const viewer of [s.otherTeacher, s.student]) {
    assert.deepEqual(await listAssignmentSubmissions(s.assignmentId, viewer), { ok: false, status: 403, reason: "forbidden" });
    assert.deepEqual(
      await reviewWriteSubmission(submitted.submission.id, viewer, { action: "grade", rubricScores: {} }, audit(viewer.id)),
      { ok: false, status: 403, reason: "forbidden" },
    );
  }
  assert.ok((await listAssignmentSubmissions(s.assignmentId, { id: s.otherTeacher.id, role: "Admin" })).ok, "system admins pass");
  assert.deepEqual(await listAssignmentSubmissions("missing", s.teacher), { ok: false, status: 404, reason: "not_found" });
  assert.deepEqual(
    await reviewWriteSubmission("missing", s.teacher, { action: "grade", rubricScores: {} }, audit(s.teacher.id)),
    { ok: false, status: 404, reason: "not_found" },
  );
  // Article default prompt applies when the assignment has no override.
  await prisma.assignment.update({ where: { id: s.assignmentId }, data: { writePrompt: null } });
  const generic = await listAssignmentSubmissions(s.assignmentId, s.teacher);
  assert.ok(generic.ok);
  assert.equal(generic.assignment.prompt, defaultWritePrompt("Coral Reefs"));
});

test("only submitted or graded work is reviewable; deleting the assignment makes work private", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("wr_review");
  const draft = await saveWriteDraft(s.student.id, article(s.articleId), { assignmentId: s.assignmentId, body: "Draft only." });
  assert.ok(draft.ok);
  assert.deepEqual(
    await reviewWriteSubmission(draft.submission.id, s.teacher, { action: "grade", rubricScores: {} }, audit(s.teacher.id)),
    { ok: false, status: 409, reason: "not_reviewable" },
  );

  const submitted = await submitWriteResponse(s.student.id, article(s.articleId), { assignmentId: s.assignmentId, body: "Final." });
  assert.ok(submitted.ok);
  await prisma.classroom.update({ where: { id: s.classroomId }, data: { archivedAt: new Date() } });
  assert.deepEqual(
    await reviewWriteSubmission(submitted.submission.id, s.teacher, { action: "grade", rubricScores: {} }, audit(s.teacher.id)),
    { ok: false, status: 409, reason: "archived" },
  );
  await prisma.classroom.update({ where: { id: s.classroomId }, data: { archivedAt: null } });

  await prisma.assignment.delete({ where: { id: s.assignmentId } });
  const orphan = await prisma.writeSubmission.findUniqueOrThrow({ where: { id: draft.submission.id } });
  assert.equal(orphan.assignmentId, null);
  assert.deepEqual(
    await reviewWriteSubmission(draft.submission.id, s.teacher, { action: "grade", rubricScores: {} }, audit(s.teacher.id)),
    { ok: false, status: 404, reason: "not_found" },
  );

  await prisma.user.delete({ where: { id: s.student.id } });
  assert.equal(await prisma.writeSubmission.count({ where: { id: draft.submission.id } }), 0);
});
