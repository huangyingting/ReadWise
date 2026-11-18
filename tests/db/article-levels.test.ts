/**
 * PostgreSQL integration tests for multi-level article variants (#1303).
 *
 * Covers saving/listing/deleting levels with measured metrics, reader level
 * resolution (request, teacher lock, targeting, recommendation), level-scoped
 * quizzes and AI text, level-scoped highlights and class annotations,
 * assignment level locks on create/update, quiz completion parity for locked
 * assignments, and cascades.
 *
 * Guarded by `enabled` (RUN_DB_INTEGRATION=1) + a PostgreSQL DATABASE_URL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ArticleStatus, ArticleVisibility, AssignmentPublishState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteArticleLevel, saveArticleLevel, adaptArticleLevel } from "@/lib/article-levels/authoring";
import {
  articleHasLevel,
  getArticleLevelVariant,
  levelKeysForArticles,
  listArticleLevels,
  listEditableArticleLevels,
  resolveReaderLevel,
} from "@/lib/article-levels/variants";
import { loadArticleTextAtLevel } from "@/lib/article-levels/ai-text";
import { getOrCreateArticleQuiz, readCachedQuiz } from "@/lib/quiz";
import { createHighlight, deleteHighlightByAnchor, listHighlights, updateHighlightByAnchor } from "@/lib/annotations";
import { markAssignmentQuizComplete } from "@/lib/classroom/completions";
import { createArticleAssignment } from "@/lib/classroom/article-assignments";
import { updateAssignment } from "@/lib/classroom/commands";
import { createGuidedAnnotation, getReaderAnnotationContext, submitAnnotationResponse } from "@/lib/classroom/annotations";
import { SYSTEM_ARTICLE_CONTEXT } from "@/lib/article-library";
import { loadPrintableArticle } from "@/lib/reader/print";
import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

function requirePostgres(): void {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");
}

const ORIGINAL_HTML =
  "<p>Coral reefs around the world are recovering faster than scientists expected after a decade of ocean heatwaves.</p>";

async function setup(label: string) {
  const orgId = id(`${label}_org`);
  const teacher = { id: id(`${label}_teacher`), role: "Reader" };
  const student = { id: id(`${label}_student`), role: "Reader" };
  const other = { id: id(`${label}_other`), role: "Reader" };
  await prisma.user.createMany({ data: [teacher, student, other].map((u) => ({ id: u.id, name: u.id, role: "Reader" as const })) });
  await prisma.profile.create({ data: { userId: student.id, englishLevel: "B1" } });
  await prisma.organization.create({ data: { id: orgId, name: "Org", slug: orgId } });
  await prisma.membership.createMany({
    data: [
      { userId: teacher.id, orgId, role: "Teacher" },
      { userId: student.id, orgId, role: "Student" },
      { userId: other.id, orgId, role: "Student" },
    ],
  });
  const classroomId = id(`${label}_class`);
  await prisma.classroom.create({ data: { id: classroomId, orgId, name: "Period 1", teacherId: teacher.id } });
  await prisma.classroomMembership.createMany({
    data: [
      { classroomId, userId: student.id, role: "Student" as const },
      { classroomId, userId: other.id, role: "Student" as const },
    ],
  });
  const articleId = id(`${label}_article`);
  await prisma.article.create({
    data: { id: articleId, title: "Reefs Rebound", content: ORIGINAL_HTML, status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PUBLIC },
  });
  return { orgId, teacher, student, other, classroomId, articleId };
}

const B1_TEXT = "Coral reefs are getting better.\n\nScientists are surprised. The water was very hot for ten years.";

test("levels save with measured metrics, list in order, and delete with their quiz", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("lv_save");
  assert.deepEqual(await listArticleLevels(s.articleId), []);
  assert.deepEqual((await levelKeysForArticles([s.articleId])).get(s.articleId), [], "single-level article");

  const b1 = await saveArticleLevel(s.articleId, "B1", { title: "Reefs Get Better", text: B1_TEXT }, { actorId: s.teacher.id, source: "manual" });
  assert.ok(b1.ok);
  assert.equal(b1.level.wordCount, 16);
  assert.ok(b1.level.lexileApprox && b1.level.lexileApprox >= 200);
  assert.ok(b1.level.cefrLevel);
  await saveArticleLevel(s.articleId, "A2", { title: "Reefs Are Better", text: "Reefs are better now." }, { actorId: null, source: "ai" });

  assert.deepEqual((await listArticleLevels(s.articleId)).map((level) => [level.levelKey, level.source]), [
    ["A2", "ai"],
    ["B1", "manual"],
  ]);
  assert.deepEqual((await levelKeysForArticles([s.articleId, "missing"])).get(s.articleId), ["A2", "B1", "original"]);
  assert.deepEqual((await listEditableArticleLevels(s.articleId)).find((level) => level.levelKey === "B1")?.text, B1_TEXT);
  assert.equal((await getArticleLevelVariant(s.articleId, "B1"))?.title, "Reefs Get Better");
  assert.equal(await getArticleLevelVariant(s.articleId, "original"), null);
  assert.equal(await articleHasLevel(s.articleId, "original"), true);
  assert.equal(await articleHasLevel(s.articleId, "B1"), true);
  assert.equal(await articleHasLevel(s.articleId, "C1"), false);
  assert.equal(await articleHasLevel(s.articleId, "bogus"), false);

  // Level-scoped quiz rows are independent and cleared when the text changes.
  await prisma.quizQuestion.createMany({
    data: [
      { articleId: s.articleId, question: "Same question?", options: ["a", "b"], correctIndex: 0 },
      { articleId: s.articleId, levelKey: "B1", question: "Same question?", options: ["c", "d"], correctIndex: 1 },
    ],
  });
  assert.deepEqual((await readCachedQuiz(s.articleId))?.map((q) => q.options), [["a", "b"]]);
  assert.deepEqual((await readCachedQuiz(s.articleId, "B1"))?.map((q) => q.options), [["c", "d"]]);
  const quiz = await getOrCreateArticleQuiz(s.articleId, SYSTEM_ARTICLE_CONTEXT, "B1");
  assert.equal(quiz?.levelKey, "B1");
  assert.equal(quiz?.questions[0]?.correctIndex, 1);
  await saveArticleLevel(s.articleId, "B1", { title: "Reefs Get Better", text: "Changed text." }, { actorId: null, source: "manual" });
  assert.equal(await readCachedQuiz(s.articleId, "B1"), null, "changed text clears the level quiz");
  assert.ok(await readCachedQuiz(s.articleId), "the original quiz is untouched");

  // Printing a level uses its title, text, and quiz; the citation stays canonical.
  const printed = await loadPrintableArticle(s.articleId, { id: s.teacher.id, role: "Reader" }, "answer-key", { level: "B1" });
  assert.ok(printed && !printed.restricted);
  assert.equal(printed.article.title, "Reefs Get Better");
  assert.match(printed.bodyHtml, /Changed text/);
  assert.match(printed.citation.text, /Reefs Rebound/);
  const fallback = await loadPrintableArticle(s.articleId, { id: s.teacher.id, role: "Reader" }, "article", { level: "C1" });
  assert.ok(fallback && !fallback.restricted);
  assert.equal(fallback.article.title, "Reefs Rebound", "missing levels print the original");

  // AI text resolves per level; unknown levels are null.
  assert.equal((await loadArticleTextAtLevel(s.articleId, "B1", SYSTEM_ARTICLE_CONTEXT))?.title, "Reefs Get Better");
  assert.equal((await loadArticleTextAtLevel(s.articleId, "original", SYSTEM_ARTICLE_CONTEXT))?.title, "Reefs Rebound");
  assert.equal(await loadArticleTextAtLevel(s.articleId, "C1", SYSTEM_ARTICLE_CONTEXT), null);
  assert.equal(await getOrCreateArticleQuiz(s.articleId, SYSTEM_ARTICLE_CONTEXT, "C1"), null, "missing level quiz is not found");

  assert.equal(await deleteArticleLevel(s.articleId, "A2"), true);
  assert.equal(await deleteArticleLevel(s.articleId, "A2"), false);
  assert.deepEqual((await listArticleLevels(s.articleId)).map((level) => level.levelKey), ["B1"]);

  // Existing levels are never overwritten by generation unless replacing.
  assert.deepEqual(await adaptArticleLevel(s.articleId, "B1"), { status: "skipped", reason: "already_exists" });
  assert.deepEqual(await adaptArticleLevel("missing-article", "B1"), { status: "failed", reason: "article_not_found" });

  await prisma.article.delete({ where: { id: s.articleId } });
  assert.equal(await prisma.articleLevel.count({ where: { articleId: s.articleId } }), 0, "levels cascade with the article");
});

test("reader level resolves from the request, recommends the profile level, and honours teacher locks", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("lv_resolve");
  // Single-level articles behave as today.
  assert.deepEqual(await resolveReaderLevel({ articleId: s.articleId, userId: s.student.id, requested: "B1" }), {
    level: "original",
    locked: false,
    options: [],
    variant: null,
  });

  await saveArticleLevel(s.articleId, "B1", { title: "Reefs Get Better", text: B1_TEXT }, { actorId: null, source: "manual" });
  await saveArticleLevel(s.articleId, "A2", { title: "Reefs Are Better", text: "Reefs are better now." }, { actorId: null, source: "manual" });

  const requested = await resolveReaderLevel({ articleId: s.articleId, userId: s.student.id, requested: "B1" });
  assert.equal(requested.level, "B1");
  assert.equal(requested.locked, false);
  assert.equal(requested.variant?.title, "Reefs Get Better");
  assert.deepEqual(requested.options.map((option) => [option.levelKey, option.recommended]), [
    ["A2", false],
    ["B1", true],
    ["original", false],
  ]);
  assert.equal((await resolveReaderLevel({ articleId: s.articleId, userId: s.student.id, requested: "C1" })).level, "original");
  assert.equal((await resolveReaderLevel({ articleId: s.articleId, userId: s.student.id, requested: undefined })).level, "original");

  // A teacher lock wins over the request, for students in the audience only.
  const created = await createArticleAssignment({
    classroomId: s.classroomId,
    organizationId: s.orgId,
    articleId: s.articleId,
    accessContext: SYSTEM_ARTICLE_CONTEXT,
    lockedLevelKey: "A2",
    studentIds: [s.student.id],
  });
  assert.ok(created.ok);
  assert.equal(created.assignment.lockedLevelKey, "A2");
  const locked = await resolveReaderLevel({ articleId: s.articleId, userId: s.student.id, requested: "original" });
  assert.equal(locked.level, "A2");
  assert.equal(locked.locked, true);
  assert.equal((await resolveReaderLevel({ articleId: s.articleId, userId: s.other.id, requested: "B1" })).locked, false, "untargeted");
  assert.equal((await resolveReaderLevel({ articleId: s.articleId, userId: s.teacher.id, requested: "B1" })).locked, false, "teachers choose");

  // Draft assignments don't lock; locks to deleted levels are ignored.
  await prisma.assignment.update({ where: { id: created.assignment.id }, data: { publishState: AssignmentPublishState.DRAFT } });
  assert.equal((await resolveReaderLevel({ articleId: s.articleId, userId: s.student.id, requested: "B1" })).level, "B1");
  await prisma.assignment.update({ where: { id: created.assignment.id }, data: { publishState: AssignmentPublishState.PUBLISHED } });
  await deleteArticleLevel(s.articleId, "A2");
  assert.equal((await resolveReaderLevel({ articleId: s.articleId, userId: s.student.id, requested: "B1" })).locked, false);

  // Locks validate against the article's levels.
  assert.deepEqual(await updateAssignment(created.assignment.id, { lockedLevelKey: "C1" }), {
    ok: false,
    status: 400,
    reason: "invalid_level",
  });
  const relocked = await updateAssignment(created.assignment.id, { lockedLevelKey: "B1" });
  assert.ok(relocked.ok);
  assert.equal(relocked.assignment.lockedLevelKey, "B1");
  const unlocked = await updateAssignment(created.assignment.id, { lockedLevelKey: null });
  assert.ok(unlocked.ok);
  assert.equal(unlocked.assignment.lockedLevelKey, null);
  assert.ok((await updateAssignment(created.assignment.id, { lockedLevelKey: "original" })).ok, "the original level always exists");
  assert.deepEqual(
    await createArticleAssignment({
      classroomId: s.classroomId,
      organizationId: s.orgId,
      articleId: s.articleId,
      accessContext: SYSTEM_ARTICLE_CONTEXT,
      lockedLevelKey: "C1",
    }),
    { ok: false, status: 400, reason: "invalid_level" },
  );
});

test("quiz completion respects level locks and records the level read", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("lv_complete");
  await saveArticleLevel(s.articleId, "B1", { title: "Reefs Get Better", text: B1_TEXT }, { actorId: null, source: "manual" });
  const lockedAssignment = await prisma.assignment.create({ data: { classroomId: s.classroomId, articleId: s.articleId, lockedLevelKey: "B1" } });

  assert.deepEqual(await markAssignmentQuizComplete({ userId: s.student.id, articleId: s.articleId, scorePct: 80 }), { completedCount: 0 });
  assert.deepEqual(
    await markAssignmentQuizComplete({ userId: s.student.id, articleId: s.articleId, scorePct: 90, levelKey: "B1" }),
    { completedCount: 1 },
  );
  const completion = await prisma.assignmentCompletion.findUniqueOrThrow({
    where: { assignmentId_studentId: { assignmentId: lockedAssignment.id, studentId: s.student.id } },
  });
  assert.equal(completion.levelKeyRead, "B1");
  assert.equal(completion.quizScore, 90);

  const open = await prisma.assignment.create({ data: { classroomId: s.classroomId, articleId: s.articleId } });
  await markAssignmentQuizComplete({ userId: s.other.id, articleId: s.articleId, scorePct: 70 });
  const openCompletion = await prisma.assignmentCompletion.findUniqueOrThrow({
    where: { assignmentId_studentId: { assignmentId: open.id, studentId: s.other.id } },
  });
  assert.equal(openCompletion.levelKeyRead, "original");
});

test("highlights and class annotations are scoped to the level whose text they anchor", { skip: !enabled }, async () => {
  requirePostgres();
  const s = await setup("lv_scope");
  await saveArticleLevel(s.articleId, "B1", { title: "Reefs Get Better", text: B1_TEXT }, { actorId: null, source: "manual" });
  const anchor = { quote: "Coral reefs", startOffset: 0, endOffset: 11 };

  const original = await createHighlight(s.student.id, s.articleId, anchor);
  const atLevel = await createHighlight(s.student.id, s.articleId, { ...anchor, levelKey: "B1", note: "level note" });
  assert.ok(original.ok && atLevel.ok);
  assert.notEqual(original.highlight.id, atLevel.highlight.id, "same offsets on different levels are distinct");
  assert.deepEqual((await listHighlights(s.student.id, s.articleId)).map((h) => h.levelKey), ["original"]);
  assert.deepEqual((await listHighlights(s.student.id, s.articleId, "B1")).map((h) => h.note), ["level note"]);

  const updated = await updateHighlightByAnchor(s.student.id, s.articleId, { ...anchor, levelKey: "B1" }, { note: "edited" });
  assert.ok(updated.ok);
  assert.equal(updated.highlight.note, "edited");
  await deleteHighlightByAnchor(s.student.id, s.articleId, { ...anchor, levelKey: "B1" });
  assert.equal(await prisma.highlight.count({ where: { userId: s.student.id, articleId: s.articleId } }), 1, "only the B1 highlight goes");

  const assignment = await prisma.assignment.create({ data: { classroomId: s.classroomId, articleId: s.articleId } });
  const audit = ({ action, targetId, metadata }: { action: string; targetId: string; metadata: Record<string, unknown> }) =>
    ({
      req: new Request("http://test/api/assignments/x/annotations"),
      session: { user: { id: s.teacher.id, role: "Reader" }, expires: "2099-01-01" },
      action,
      targetType: "assignment_annotation",
      targetId,
      metadata,
    }) as never;
  const guide = await createGuidedAnnotation(s.teacher, assignment.id, { ...anchor, levelKey: "B1", prompt: "Why?" }, audit);
  assert.ok(guide.ok);
  assert.equal(guide.guide.levelKey, "B1");
  assert.deepEqual(
    await createGuidedAnnotation(s.teacher, assignment.id, { ...anchor, levelKey: "C1", prompt: "Why?" }, audit),
    { ok: false, status: 400, reason: "invalid_anchor" },
    "levels the article lacks are rejected",
  );

  const reply = await submitAnnotationResponse(s.student, assignment.id, { annotationId: guide.guide.id, body: "Because." });
  assert.ok(reply.ok);
  assert.equal(reply.response.levelKey, "B1", "replies inherit their prompt's level");
  const evidence = await submitAnnotationResponse(s.student, assignment.id, { anchor: { ...anchor, levelKey: "B1" }, body: "" });
  assert.ok(evidence.ok);
  assert.equal(evidence.response.levelKey, "B1");
  assert.deepEqual(
    await submitAnnotationResponse(s.student, assignment.id, { anchor: { ...anchor, levelKey: "C1" }, body: "" }),
    { ok: false, status: 400, reason: "invalid_anchor" },
  );
  const plain = await submitAnnotationResponse(s.student, assignment.id, { body: "General note." });
  assert.ok(plain.ok);
  assert.equal(plain.response.levelKey, "original");

  // Every level's prompts and responses are listed with their level, so a
  // student reading (or locked to) another level still sees the prompt.
  const context = await getReaderAnnotationContext(s.student, s.articleId);
  assert.deepEqual(context.guides.map((g) => [g.id, g.levelKey]), [[guide.guide.id, "B1"]]);
  assert.deepEqual(
    context.responses.map((r) => [r.body, r.levelKey]).sort(),
    [["", "B1"], ["Because.", "B1"], ["General note.", "original"]],
  );
});
