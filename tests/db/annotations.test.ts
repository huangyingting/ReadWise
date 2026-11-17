/**
 * PostgreSQL integration tests for classroom annotations (#1307).
 *
 * Covers guided prompt create/edit/delete with ids-only audit, RBAC (teacher,
 * org admin, system admin, other-tenant teacher, students), assignment
 * visibility (targeting, drafts, other classrooms), learner replies and
 * evidence, privacy of personal highlights and other learners' responses,
 * archived classrooms, withdrawal, and cascades.
 *
 * Guarded by `enabled` (RUN_DB_INTEGRATION=1) + a PostgreSQL DATABASE_URL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ArticleStatus, ArticleVisibility, AssignmentPublishState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createGuidedAnnotation,
  deleteAnnotationResponse,
  deleteGuidedAnnotation,
  getAssignmentAnnotationReview,
  getReaderAnnotationContext,
  submitAnnotationResponse,
  updateGuidedAnnotation,
} from "@/lib/classroom/annotations";
import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

type Viewer = { id: string; role: string };

function requirePostgres(): void {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");
}

function audit(actorId: string) {
  return ({ action, targetId, metadata }: { action: string; targetId: string; metadata: Record<string, unknown> }) =>
    ({
      req: new Request("http://test/api/assignments/x/annotations"),
      session: { user: { id: actorId, role: "Reader" }, expires: "2099-01-01" },
      action,
      targetType: "assignment_annotation",
      targetId,
      metadata,
    }) as never;
}

const anchor = { quote: "reefs can recover", startOffset: 12, endOffset: 29, prefix: "Scientists say ", suffix: " if waters cool" };

async function setup(label: string) {
  const orgId = id(`${label}_org`);
  const otherOrgId = id(`${label}_org2`);
  const users = {
    teacher: { id: id(`${label}_teacher`), role: "Reader" },
    orgAdmin: { id: id(`${label}_admin`), role: "Reader" },
    student: { id: id(`${label}_student`), role: "Reader" },
    otherStudent: { id: id(`${label}_student2`), role: "Reader" },
    outsider: { id: id(`${label}_outsider`), role: "Reader" },
    otherTeacher: { id: id(`${label}_teacher2`), role: "Reader" },
  } satisfies Record<string, Viewer>;
  await prisma.user.createMany({ data: Object.values(users).map((u) => ({ id: u.id, name: u.id, role: "Reader" as const })) });
  await prisma.organization.createMany({
    data: [
      { id: orgId, name: "Org", slug: orgId },
      { id: otherOrgId, name: "Other", slug: otherOrgId },
    ],
  });
  await prisma.membership.createMany({
    data: [
      { userId: users.teacher.id, orgId, role: "Teacher" },
      { userId: users.orgAdmin.id, orgId, role: "OrgAdmin" },
      { userId: users.student.id, orgId, role: "Student" },
      { userId: users.otherStudent.id, orgId, role: "Student" },
      { userId: users.outsider.id, orgId, role: "Student" },
      { userId: users.otherTeacher.id, orgId: otherOrgId, role: "Teacher" },
    ],
  });
  const classroomId = id(`${label}_class`);
  const otherClassroomId = id(`${label}_class2`);
  await prisma.classroom.createMany({
    data: [
      { id: classroomId, orgId, name: "Period 1", teacherId: users.teacher.id },
      { id: otherClassroomId, orgId: otherOrgId, name: "Elsewhere", teacherId: users.otherTeacher.id },
    ],
  });
  await prisma.classroomMembership.createMany({
    data: [
      { classroomId, userId: users.student.id, role: "Student" as const },
      { classroomId, userId: users.otherStudent.id, role: "Student" as const },
    ],
  });
  const articleId = id(`${label}_article`);
  await prisma.article.create({
    data: { id: articleId, title: "Coral Reefs", content: "<p>x</p>", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PUBLIC },
  });
  const assignment = await prisma.assignment.create({ data: { classroomId, articleId } });
  const otherAssignment = await prisma.assignment.create({ data: { classroomId: otherClassroomId, articleId } });
  return { ...users, orgId, classroomId, otherClassroomId, articleId, assignmentId: assignment.id, otherAssignmentId: otherAssignment.id };
}

async function addGuide(s: Awaited<ReturnType<typeof setup>>, prompt = "Why can reefs recover?") {
  const created = await createGuidedAnnotation(s.teacher, s.assignmentId, { ...anchor, prompt }, audit(s.teacher.id));
  assert.ok(created.ok);
  return created.guide;
}

test("teachers create, edit, and delete guided prompts with ids-only audit", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("an_crud");
  const guide = await addGuide(s, "Underline the evidence for recovery.");
  assert.equal(guide.prompt, "Underline the evidence for recovery.");
  assert.equal(guide.canEdit, true);
  assert.equal(guide.classroomName, "Period 1");
  assert.equal(guide.prefix, anchor.prefix);

  const updated = await updateGuidedAnnotation(s.teacher, guide.id, "Explain the evidence.", audit(s.teacher.id));
  assert.ok(updated.ok);
  assert.equal(updated.guide.prompt, "Explain the evidence.");

  // The org admin may manage the classroom too.
  const byAdmin = await updateGuidedAnnotation(s.orgAdmin, guide.id, "Admin edit.", audit(s.orgAdmin.id));
  assert.ok(byAdmin.ok);

  assert.deepEqual(await deleteGuidedAnnotation(s.teacher, guide.id, audit(s.teacher.id)), { ok: true });
  assert.equal(await prisma.assignmentAnnotation.count({ where: { id: guide.id } }), 0);

  const audits = await prisma.auditLog.findMany({
    where: { targetId: guide.id },
    select: { action: true, metadata: true },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(audits.map((row) => row.action), [
    "assignment_annotation.create",
    "assignment_annotation.update",
    "assignment_annotation.update",
    "assignment_annotation.delete",
  ]);
  assert.match(JSON.stringify(audits[0].metadata), /assignmentId.*classroomId/);
  assert.equal(JSON.stringify(audits).includes("evidence"), false, "no prompt text in audit");

  // Anchors must be valid.
  assert.deepEqual(
    await createGuidedAnnotation(s.teacher, s.assignmentId, { ...anchor, startOffset: 30, endOffset: 30, prompt: "x" }, audit(s.teacher.id)),
    { ok: false, status: 400, reason: "invalid_anchor" },
  );
  assert.deepEqual(
    await createGuidedAnnotation(s.teacher, s.assignmentId, { ...anchor, quote: "x".repeat(2001), prompt: "x" }, audit(s.teacher.id)),
    { ok: false, status: 400, reason: "invalid_anchor" },
  );
});

test("only classroom managers manage prompts; other tenants and students cannot", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("an_rbac");
  const guide = await addGuide(s);
  for (const viewer of [s.student, s.otherTeacher, s.outsider]) {
    assert.deepEqual(
      await createGuidedAnnotation(viewer, s.assignmentId, { ...anchor, prompt: "x" }, audit(viewer.id)),
      { ok: false, status: 403, reason: "forbidden" },
    );
    assert.deepEqual(await updateGuidedAnnotation(viewer, guide.id, "x", audit(viewer.id)), { ok: false, status: 403, reason: "forbidden" });
    assert.deepEqual(await deleteGuidedAnnotation(viewer, guide.id, audit(viewer.id)), { ok: false, status: 403, reason: "forbidden" });
    assert.deepEqual(await getAssignmentAnnotationReview(s.assignmentId, viewer), { ok: false, status: 403, reason: "forbidden" });
  }
  // The other-tenant teacher can't touch this classroom, and this teacher can't touch theirs.
  assert.deepEqual(
    await createGuidedAnnotation(s.teacher, s.otherAssignmentId, { ...anchor, prompt: "x" }, audit(s.teacher.id)),
    { ok: false, status: 403, reason: "forbidden" },
  );
  assert.ok((await getAssignmentAnnotationReview(s.assignmentId, { id: s.otherTeacher.id, role: "Admin" })).ok, "system admins pass");

  for (const missing of [
    await createGuidedAnnotation(s.teacher, "missing", { ...anchor, prompt: "x" }, audit(s.teacher.id)),
    await updateGuidedAnnotation(s.teacher, "missing", "x", audit(s.teacher.id)),
    await deleteGuidedAnnotation(s.teacher, "missing", audit(s.teacher.id)),
    await getAssignmentAnnotationReview("missing", s.teacher),
  ]) {
    assert.deepEqual(missing, { ok: false, status: 404, reason: "not_found" });
  }

  await prisma.classroom.update({ where: { id: s.classroomId }, data: { archivedAt: new Date() } });
  assert.deepEqual(
    await createGuidedAnnotation(s.teacher, s.assignmentId, { ...anchor, prompt: "x" }, audit(s.teacher.id)),
    { ok: false, status: 409, reason: "archived" },
  );
  assert.deepEqual(await updateGuidedAnnotation(s.teacher, guide.id, "x", audit(s.teacher.id)), { ok: false, status: 409, reason: "archived" });
});

test("the reader context shows prompts to the assignment's audience only", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("an_ctx");
  const guide = await addGuide(s);
  // Teacher-role classroom members are not learners.
  await prisma.classroomMembership.create({ data: { classroomId: s.classroomId, userId: s.teacher.id, role: "Teacher" } });

  const forTeacher = await getReaderAnnotationContext(s.teacher, s.articleId);
  assert.deepEqual(forTeacher.teaching, [{ assignmentId: s.assignmentId, classroomName: "Period 1" }]);
  assert.deepEqual(forTeacher.learning, []);
  assert.deepEqual(forTeacher.guides.map((g) => [g.id, g.canEdit]), [[guide.id, true]]);

  const forAdmin = await getReaderAnnotationContext(s.orgAdmin, s.articleId);
  assert.deepEqual(forAdmin.teaching.map((t) => t.assignmentId), [s.assignmentId], "org admins manage org classrooms");

  const forStudent = await getReaderAnnotationContext(s.student, s.articleId);
  assert.deepEqual(forStudent.teaching, []);
  assert.deepEqual(forStudent.learning, [{ assignmentId: s.assignmentId, classroomName: "Period 1" }]);
  assert.deepEqual(forStudent.guides.map((g) => [g.id, g.canEdit, g.prompt]), [[guide.id, false, "Why can reefs recover?"]]);

  for (const viewer of [s.outsider, s.otherTeacher]) {
    const context = await getReaderAnnotationContext(viewer, s.articleId);
    assert.deepEqual(context.guides.filter((g) => g.assignmentId === s.assignmentId), [], "no prompts outside the classroom");
  }

  // Targeted assignments hide prompts from untargeted students.
  await prisma.assignment.update({
    where: { id: s.assignmentId },
    data: { wholeClass: false, everTargeted: true, targets: { create: { studentId: s.student.id } } },
  });
  assert.equal((await getReaderAnnotationContext(s.student, s.articleId)).guides.length, 1);
  assert.deepEqual(await getReaderAnnotationContext(s.otherStudent, s.articleId), { teaching: [], learning: [], guides: [], responses: [] });

  // Draft assignments are not live for students.
  await prisma.assignment.update({ where: { id: s.assignmentId }, data: { publishState: AssignmentPublishState.DRAFT } });
  assert.deepEqual((await getReaderAnnotationContext(s.student, s.articleId)).guides, []);
});

test("learners reply and share evidence; responses stay between the learner and teacher", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("an_resp");
  const guide = await addGuide(s);
  // A personal highlight with a private note is never visible to the teacher.
  await prisma.highlight.create({
    data: { userId: s.student.id, articleId: s.articleId, ...anchor, note: "my private note" },
  });

  const reply = await submitAnnotationResponse(s.student, s.assignmentId, { annotationId: guide.id, body: "  Cooler water helps.  " });
  assert.ok(reply.ok);
  assert.equal(reply.response.body, "Cooler water helps.");
  assert.equal(reply.response.quote, null);
  const evidence = await submitAnnotationResponse(s.student, s.assignmentId, { anchor, body: "" });
  assert.ok(evidence.ok);
  assert.equal(evidence.response.quote, anchor.quote);
  assert.equal(evidence.response.annotationId, null);
  const other = await submitAnnotationResponse(s.otherStudent, s.assignmentId, { annotationId: guide.id, body: "Other reply." });
  assert.ok(other.ok);

  assert.deepEqual(await submitAnnotationResponse(s.student, s.assignmentId, { body: "   " }), {
    ok: false,
    status: 400,
    reason: "empty_response",
  });
  assert.deepEqual(
    await submitAnnotationResponse(s.student, s.assignmentId, { anchor: { ...anchor, startOffset: 40, endOffset: 3 }, body: "x" }),
    { ok: false, status: 400, reason: "invalid_anchor" },
  );
  // Prompts from other assignments, assignments the learner isn't in, and teachers are rejected.
  const foreignGuide = await createGuidedAnnotation(
    s.otherTeacher,
    s.otherAssignmentId,
    { ...anchor, prompt: "Elsewhere" },
    audit(s.otherTeacher.id),
  );
  assert.ok(foreignGuide.ok);
  for (const [viewer, assignmentId, annotationId] of [
    [s.student, s.assignmentId, foreignGuide.guide.id],
    [s.student, s.otherAssignmentId, null],
    [s.outsider, s.assignmentId, guide.id],
    [s.teacher, s.assignmentId, guide.id],
    [s.student, "missing", null],
  ] as const) {
    assert.deepEqual(await submitAnnotationResponse(viewer, assignmentId, { annotationId, body: "x" }), {
      ok: false,
      status: 404,
      reason: "not_found",
    });
  }

  // Each learner sees only their own responses.
  const studentContext = await getReaderAnnotationContext(s.student, s.articleId);
  assert.deepEqual(studentContext.responses.map((r) => r.id).sort(), [reply.response.id, evidence.response.id].sort());
  const teacherContext = await getReaderAnnotationContext(s.teacher, s.articleId);
  assert.deepEqual(teacherContext.responses, [], "teachers review on the assignment page, not in their own reader");

  // The teacher sees replies grouped by prompt plus loose evidence — never the private highlight note.
  const review = await getAssignmentAnnotationReview(s.assignmentId, s.teacher);
  assert.ok(review.ok);
  assert.equal(review.review.assignment.articleTitle, "Coral Reefs");
  assert.deepEqual(review.review.guides[0].responses.map((r) => [r.student.id, r.body]), [
    [s.student.id, "Cooler water helps."],
    [s.otherStudent.id, "Other reply."],
  ]);
  assert.deepEqual(review.review.evidence.map((r) => [r.student.id, r.quote]), [[s.student.id, anchor.quote]]);
  assert.equal(JSON.stringify(review).includes("my private note"), false);

  // Learners withdraw only their own responses.
  assert.deepEqual(await deleteAnnotationResponse(s.otherStudent, reply.response.id), { ok: false, status: 404, reason: "not_found" });
  assert.deepEqual(await deleteAnnotationResponse(s.student, reply.response.id), { ok: true });
  assert.equal(await prisma.assignmentAnnotationResponse.count({ where: { id: reply.response.id } }), 0);
});

test("deleting prompts, assignments, and users cascades responses", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("an_cascade");
  const guide = await addGuide(s);
  const reply = await submitAnnotationResponse(s.student, s.assignmentId, { annotationId: guide.id, body: "Reply" });
  const evidence = await submitAnnotationResponse(s.student, s.assignmentId, { anchor, body: "Evidence" });
  const otherEvidence = await submitAnnotationResponse(s.otherStudent, s.assignmentId, { anchor, body: "Mine" });
  assert.ok(reply.ok && evidence.ok && otherEvidence.ok);

  await deleteGuidedAnnotation(s.teacher, guide.id, audit(s.teacher.id));
  assert.equal(await prisma.assignmentAnnotationResponse.count({ where: { id: reply.response.id } }), 0, "replies go with the prompt");
  assert.equal(await prisma.assignmentAnnotationResponse.count({ where: { id: evidence.response.id } }), 1, "loose evidence stays");

  await prisma.user.delete({ where: { id: s.otherStudent.id } });
  assert.equal(await prisma.assignmentAnnotationResponse.count({ where: { id: otherEvidence.response.id } }), 0);

  const second = await createGuidedAnnotation(s.orgAdmin, s.assignmentId, { ...anchor, prompt: "Admin prompt" }, audit(s.orgAdmin.id));
  assert.ok(second.ok);
  await prisma.user.delete({ where: { id: s.orgAdmin.id } });
  assert.equal(
    (await prisma.assignmentAnnotation.findUniqueOrThrow({ where: { id: second.guide.id } })).authorId,
    null,
    "prompts outlive their author",
  );

  await prisma.assignment.delete({ where: { id: s.assignmentId } });
  assert.equal(await prisma.assignmentAnnotation.count({ where: { assignmentId: s.assignmentId } }), 0);
  assert.equal(await prisma.assignmentAnnotationResponse.count({ where: { assignmentId: s.assignmentId } }), 0);
});
