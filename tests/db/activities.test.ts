/**
 * PostgreSQL integration tests for reader activities and educator tools (#1304).
 *
 * Covers poll and Check for Understanding management (RBAC, validation,
 * archived classrooms, audit), student voting/answering with aggregate-only
 * results and first-answer-final checks, audience isolation, educator preview,
 * educator detection and reader context, managed classrooms, lesson scaffold
 * fallback, and cascades.
 *
 * Guarded by `enabled` (RUN_DB_INTEGRATION=1) + a PostgreSQL DATABASE_URL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ArticleStatus, ArticleVisibility, AssignmentPublishState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  addAssignmentCheck,
  answerCheck,
  deleteAssignmentCheck,
  deleteAssignmentPoll,
  getAssignmentActivities,
  getReaderActivities,
  saveAssignmentPoll,
  votePoll,
} from "@/lib/classroom/activities";
import { isEducator, listManagedClassrooms } from "@/lib/classroom/educator";
import { loadEducatorReaderContext } from "@/lib/lesson/reader-context";
import { getOrCreateLessonScaffold } from "@/lib/lesson/scaffold";
import { SYSTEM_ARTICLE_CONTEXT } from "@/lib/article-library";
import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

function requirePostgres(): void {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");
}

function audit(actorId: string) {
  return ({ action, targetId, metadata }: { action: string; targetId: string; metadata: Record<string, unknown> }) =>
    ({
      req: new Request("http://test/api/assignments/x/poll"),
      session: { user: { id: actorId, role: "Reader" }, expires: "2099-01-01" },
      action,
      targetType: "assignment_activity",
      targetId,
      metadata,
    }) as never;
}

async function setup(label: string) {
  const orgId = id(`${label}_org`);
  const otherOrgId = id(`${label}_org2`);
  const users = {
    teacher: { id: id(`${label}_teacher`), role: "Reader" },
    student: { id: id(`${label}_student`), role: "Reader" },
    other: { id: id(`${label}_other`), role: "Reader" },
    outsider: { id: id(`${label}_outsider`), role: "Reader" },
    otherTeacher: { id: id(`${label}_teacher2`), role: "Reader" },
  };
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
      { userId: users.student.id, orgId, role: "Student" },
      { userId: users.other.id, orgId, role: "Student" },
      { userId: users.outsider.id, orgId, role: "Student" },
      { userId: users.otherTeacher.id, orgId: otherOrgId, role: "Teacher" },
    ],
  });
  const classroomId = id(`${label}_class`);
  await prisma.classroom.create({ data: { id: classroomId, orgId, name: "Period 1", teacherId: users.teacher.id } });
  await prisma.classroomMembership.createMany({
    data: [
      { classroomId, userId: users.student.id, role: "Student" as const },
      { classroomId, userId: users.other.id, role: "Student" as const },
    ],
  });
  const articleId = id(`${label}_article`);
  await prisma.article.create({
    data: {
      id: articleId,
      title: "Reefs Rebound",
      content: "<p>Scientists studied coral restoration in Florida. Coral restoration needs volunteers.</p>",
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
    },
  });
  const assignment = await prisma.assignment.create({ data: { classroomId, articleId } });
  return { ...users, orgId, classroomId, articleId, assignmentId: assignment.id };
}

const POLL = { question: "Should cities protect reefs?", options: [" Yes ", "No", "Not sure"] };
const CHECK = { afterBlock: 2, question: "What helps reefs?", options: ["Volunteers", "Pollution"], correctIndex: 0, explanation: " Restoration needs help. " };

test("teachers manage polls and checks with ids-only audit; others cannot", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("act_manage");
  const saved = await saveAssignmentPoll(s.teacher, s.assignmentId, POLL, audit(s.teacher.id));
  assert.ok(saved.ok);
  const check = await addAssignmentCheck(s.teacher, s.assignmentId, CHECK, audit(s.teacher.id));
  assert.ok(check.ok);

  const view = await getAssignmentActivities(s.teacher, s.assignmentId);
  assert.ok(view.ok);
  assert.deepEqual(view.activities.poll?.options, ["Yes", "No", "Not sure"]);
  assert.deepEqual(view.activities.poll?.distribution, [0, 0, 0]);
  assert.equal(view.activities.checks[0].explanation, "Restoration needs help.");
  assert.equal(view.activities.assignment.classroomName, "Period 1");

  for (const bad of [
    { question: "Q", options: ["Only one"] },
    { question: "Q", options: ["Same", " same ".trim(), "Same"] },
    { question: "  ", options: ["A", "B"] },
  ]) {
    assert.deepEqual(await saveAssignmentPoll(s.teacher, s.assignmentId, bad, audit(s.teacher.id)), {
      ok: false,
      status: 400,
      reason: "invalid_activity",
    });
  }
  for (const bad of [
    { ...CHECK, correctIndex: 2 },
    { ...CHECK, options: ["A", " "] },
    { ...CHECK, question: " " },
  ]) {
    assert.deepEqual(await addAssignmentCheck(s.teacher, s.assignmentId, bad, audit(s.teacher.id)), {
      ok: false,
      status: 400,
      reason: "invalid_activity",
    });
  }

  for (const viewer of [s.student, s.otherTeacher, s.outsider]) {
    assert.deepEqual(await getAssignmentActivities(viewer, s.assignmentId), { ok: false, status: 403, reason: "forbidden" });
    assert.deepEqual(await saveAssignmentPoll(viewer, s.assignmentId, POLL, audit(viewer.id)), { ok: false, status: 403, reason: "forbidden" });
    assert.deepEqual(await deleteAssignmentCheck(viewer, check.checkId, audit(viewer.id)), { ok: false, status: 403, reason: "forbidden" });
  }
  assert.deepEqual(await getAssignmentActivities(s.teacher, "missing"), { ok: false, status: 404, reason: "not_found" });
  assert.deepEqual(await deleteAssignmentCheck(s.teacher, "missing", audit(s.teacher.id)), { ok: false, status: 404, reason: "not_found" });

  const audits = await prisma.auditLog.findMany({ where: { actorId: s.teacher.id }, select: { action: true, metadata: true } });
  assert.deepEqual(audits.map((row) => row.action).sort(), ["assignment_check.create", "assignment_poll.save"]);
  assert.equal(JSON.stringify(audits).includes("reefs"), false, "no question text in audit");

  assert.deepEqual(await deleteAssignmentCheck(s.teacher, check.checkId, audit(s.teacher.id)), { ok: true });
  assert.deepEqual(await deleteAssignmentPoll(s.teacher, s.assignmentId, audit(s.teacher.id)), { ok: true });
  assert.deepEqual(await deleteAssignmentPoll(s.teacher, s.assignmentId, audit(s.teacher.id)), { ok: false, status: 404, reason: "not_found" });

  await prisma.classroom.update({ where: { id: s.classroomId }, data: { archivedAt: new Date() } });
  assert.deepEqual(await saveAssignmentPoll(s.teacher, s.assignmentId, POLL, audit(s.teacher.id)), { ok: false, status: 409, reason: "archived" });
  assert.ok((await getAssignmentActivities(s.teacher, s.assignmentId)).ok, "archived classrooms stay readable");
});

test("students vote and answer; results stay aggregate and answers final", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("act_student");
  const poll = await saveAssignmentPoll(s.teacher, s.assignmentId, POLL, audit(s.teacher.id));
  const check = await addAssignmentCheck(s.teacher, s.assignmentId, CHECK, audit(s.teacher.id));
  assert.ok(poll.ok && check.ok);

  const before = await getReaderActivities(s.student, s.articleId);
  assert.equal(before.mode, "student");
  assert.deepEqual(before.polls.map((p) => [p.myVote, p.distribution, p.classroomName]), [[null, null, "Period 1"]], "no results before voting");
  assert.deepEqual(before.checks.map((c) => [c.afterBlock, c.result]), [[2, null]], "no answer key before answering");

  assert.deepEqual(await votePoll(s.other, poll.pollId, 1), { ok: true, myVote: 1, distribution: [0, 1, 0] });
  assert.deepEqual(await votePoll(s.student, poll.pollId, 0), { ok: true, myVote: 0, distribution: [1, 1, 0] });
  assert.deepEqual(await votePoll(s.student, poll.pollId, 2), { ok: true, myVote: 2, distribution: [0, 1, 1] }, "votes can change");
  assert.deepEqual(await votePoll(s.student, poll.pollId, 3), { ok: false, status: 400, reason: "invalid_option" });

  assert.deepEqual(await answerCheck(s.student, check.checkId, 1), {
    ok: true,
    result: { selectedIndex: 1, correct: false, correctIndex: 0, explanation: "Restoration needs help." },
  });
  assert.deepEqual(await answerCheck(s.student, check.checkId, 0), { ok: false, status: 409, reason: "already_answered" });
  assert.deepEqual(await answerCheck(s.other, check.checkId, 5), { ok: false, status: 400, reason: "invalid_option" });
  assert.ok((await answerCheck(s.other, check.checkId, 0)).ok);

  const after = await getReaderActivities(s.student, s.articleId);
  assert.deepEqual(after.polls[0].distribution, [0, 1, 1]);
  assert.equal(after.polls[0].myVote, 2);
  assert.deepEqual(after.checks[0].result, { selectedIndex: 1, correct: false, correctIndex: 0, explanation: "Restoration needs help." });

  const teacherView = await getAssignmentActivities(s.teacher, s.assignmentId);
  assert.ok(teacherView.ok);
  assert.equal(teacherView.activities.poll?.voters, 2);
  assert.deepEqual([teacherView.activities.checks[0].answered, teacherView.activities.checks[0].correctCount], [2, 1]);

  // Outsiders, teachers, and other tenants can't respond; nothing leaks to them.
  for (const viewer of [s.outsider, s.teacher, s.otherTeacher]) {
    assert.deepEqual(await votePoll(viewer, poll.pollId, 0), { ok: false, status: 404, reason: "not_found" });
    assert.deepEqual(await answerCheck(viewer, check.checkId, 0), { ok: false, status: 404, reason: "not_found" });
    assert.deepEqual(await getReaderActivities(viewer, s.articleId), { mode: "none", polls: [], checks: [] });
  }
  assert.deepEqual(await votePoll(s.student, "missing", 0), { ok: false, status: 404, reason: "not_found" });

  // Changing the poll clears its votes; deleting the user removes their responses.
  await saveAssignmentPoll(s.teacher, s.assignmentId, { question: "New?", options: ["A", "B"] }, audit(s.teacher.id));
  assert.equal(await prisma.assignmentPollVote.count({ where: { pollId: poll.pollId } }), 0);
  await prisma.user.delete({ where: { id: s.other.id } });
  assert.equal(await prisma.assignmentCheckAnswer.count({ where: { checkId: check.checkId } }), 1);

  // Drafts hide activities from students.
  await prisma.assignment.update({ where: { id: s.assignmentId }, data: { publishState: AssignmentPublishState.DRAFT } });
  assert.equal((await getReaderActivities(s.student, s.articleId)).mode, "none");

  await prisma.assignment.delete({ where: { id: s.assignmentId } });
  assert.equal(await prisma.assignmentCheck.count({ where: { assignmentId: s.assignmentId } }), 0);
  assert.equal(await prisma.assignmentPoll.count({ where: { assignmentId: s.assignmentId } }), 0);
});

test("educators are detected, preview their activities, and get a reader context", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("act_educator");
  assert.equal(await isEducator(s.teacher), true);
  assert.equal(await isEducator(s.student), false);
  assert.equal(await isEducator({ id: s.student.id, role: "Admin" }), true, "content staff");

  assert.deepEqual(await getReaderActivities(s.teacher, s.articleId, { preview: true }), { mode: "preview", polls: [], checks: [] });
  const poll = await saveAssignmentPoll(s.teacher, s.assignmentId, POLL, audit(s.teacher.id));
  assert.ok(poll.ok);
  await addAssignmentCheck(s.teacher, s.assignmentId, CHECK, audit(s.teacher.id));
  await votePoll(s.student, poll.pollId, 0);
  const preview = await getReaderActivities(s.teacher, s.articleId, { preview: true });
  assert.equal(preview.mode, "preview");
  assert.deepEqual(preview.polls[0].distribution, [1, 0, 0], "preview shows the live distribution");
  assert.equal(preview.checks[0].result, null);

  assert.deepEqual(await listManagedClassrooms(s.teacher), [{ id: s.classroomId, name: "Period 1" }]);
  assert.deepEqual(await listManagedClassrooms(s.student), []);

  assert.deepEqual(await loadEducatorReaderContext(s.student, s.articleId, "student"), {
    isEducator: false,
    previewing: false,
    previewLock: null,
    classrooms: [],
  });
  const tools = await loadEducatorReaderContext(s.teacher, s.articleId, undefined);
  assert.deepEqual(tools, { isEducator: true, previewing: false, previewLock: null, classrooms: [{ id: s.classroomId, name: "Period 1" }] });
  assert.deepEqual(await loadEducatorReaderContext(s.teacher, s.articleId, "student"), {
    isEducator: true,
    previewing: true,
    previewLock: null,
    classrooms: [],
  });
  await prisma.assignment.update({ where: { id: s.assignmentId }, data: { lockedLevelKey: "B1" } });
  assert.equal((await loadEducatorReaderContext(s.teacher, s.articleId, "student")).previewLock, "B1");
  const otherArticle = id("act_educator_article2");
  await prisma.article.create({
    data: { id: otherArticle, title: "Other", content: "<p>x</p>", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PUBLIC },
  });
  assert.equal((await loadEducatorReaderContext(s.teacher, otherArticle, "student")).previewLock, null, "no teaching assignment");
});

test("lesson scaffolds fall back to the article text without AI", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("act_scaffold");
  const scaffold = await getOrCreateLessonScaffold(s.articleId, SYSTEM_ARTICLE_CONTEXT);
  assert.ok(scaffold);
  if (scaffold.fallback) {
    assert.match(scaffold.hook, /Reefs Rebound/);
    assert.equal(scaffold.keyTerms[0].term, "restoration");
    assert.equal(await prisma.articleLessonScaffold.count({ where: { articleId: s.articleId } }), 0, "fallbacks aren't cached");
  }
  // A cached scaffold is returned as-is.
  await prisma.articleLessonScaffold.upsert({
    where: { articleId: s.articleId },
    create: {
      articleId: s.articleId,
      hook: "Cached hook",
      questions: ["Q1?", 3],
      keyTerms: [{ term: "reef", definition: "an underwater ridge" }, { bogus: true }],
      promptVersion: "lesson-scaffold/v1",
    },
    update: {},
  });
  const cached = await getOrCreateLessonScaffold(s.articleId, SYSTEM_ARTICLE_CONTEXT);
  assert.deepEqual(cached, {
    hook: "Cached hook",
    questions: ["Q1?"],
    keyTerms: [{ term: "reef", definition: "an underwater ridge", context: null }],
    fallback: false,
  });
  assert.equal(await getOrCreateLessonScaffold("missing-article", SYSTEM_ARTICLE_CONTEXT), null);
});
