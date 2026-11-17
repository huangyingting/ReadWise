/**
 * PostgreSQL integration tests for reading skills and maturity bands (#1302).
 *
 * Covers: per-question answers persisted with a graded attempt (and cascading
 * with it), the classroom skills matrix over real rows with a retake,
 * browse facets on the real `quizQuestions.some` relation filter and maturity
 * band, and question removal clearing the answer link.
 *
 * Guarded by `enabled` (RUN_DB_INTEGRATION=1) + a PostgreSQL DATABASE_URL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ArticleStatus, ArticleVisibility } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordQuizAttempt } from "@/lib/learning/quiz-mastery";
import { getClassroomSkillMatrix } from "@/lib/classroom/skills";
import { articleFacetFilters } from "@/lib/article-library/listings";
import { enabled, isPostgres } from "./support/db-config";
import { id, registerIntegrationCleanup } from "./support/db-helpers";

registerIntegrationCleanup();

function requirePostgres(): void {
  assert.equal(isPostgres, true, "test:db requires a PostgreSQL DATABASE_URL");
}

async function createArticleWithQuiz(label: string, maturityBand = "general") {
  const articleId = id(label);
  await prisma.article.create({
    data: {
      id: articleId,
      title: label,
      content: "<p>Body.</p>",
      status: ArticleStatus.PUBLISHED,
      visibility: ArticleVisibility.PUBLIC,
      maturityBand,
    },
  });
  const questions = await Promise.all(
    [
      { question: `${label}: what is the main idea?`, skillTag: "main_idea" },
      { question: `${label}: what does scarce mean?`, skillTag: "vocabulary_in_context" },
    ].map((q) =>
      prisma.quizQuestion.create({
        data: { articleId, question: q.question, options: ["a", "b"], correctIndex: 0, skillTag: q.skillTag },
        select: { id: true, skillTag: true },
      }),
    ),
  );
  return { articleId, questions };
}

function graded(questions: Array<{ id: string; skillTag: string }>, correct: boolean[]) {
  return questions.map((question, index) => ({
    questionIndex: index,
    questionId: question.id,
    skillTag: question.skillTag as "main_idea",
    selectedIndex: correct[index] ? 0 : 1,
    correct: correct[index]!,
  }));
}

test("graded attempts store per-question answers that cascade with the attempt", { skip: !enabled }, async () => {
  requirePostgres();
  const userId = id("rs_user");
  await prisma.user.create({ data: { id: userId, name: "Learner", role: "Reader" } });
  const { articleId, questions } = await createArticleWithQuiz("rs_cascade");

  const { attempt } = await recordQuizAttempt(userId, articleId, 1, 2, {
    answers: graded(questions, [true, false]),
  });
  const rows = await prisma.quizAttemptAnswer.findMany({
    where: { attemptId: attempt.id },
    orderBy: { questionIndex: "asc" },
    select: { questionId: true, skillTag: true, correct: true },
  });
  assert.deepEqual(rows, [
    { questionId: questions[0]!.id, skillTag: "main_idea", correct: true },
    { questionId: questions[1]!.id, skillTag: "vocabulary_in_context", correct: false },
  ]);

  // Regenerating the quiz removes questions; the answer keeps its skill.
  await prisma.quizQuestion.delete({ where: { id: questions[0]!.id } });
  const orphaned = await prisma.quizAttemptAnswer.findFirstOrThrow({
    where: { attemptId: attempt.id, questionIndex: 0 },
  });
  assert.equal(orphaned.questionId, null);
  assert.equal(orphaned.skillTag, "main_idea");

  await prisma.quizAttempt.delete({ where: { id: attempt.id } });
  assert.equal(await prisma.quizAttemptAnswer.count({ where: { attemptId: attempt.id } }), 0);
});

test("the classroom skills matrix uses each student's latest attempt", { skip: !enabled }, async () => {
  requirePostgres();
  const orgId = id("rs_org");
  const classroomId = id("rs_class");
  const [teacherId, studentA, studentB] = [id("rs_teacher"), id("rs_a"), id("rs_b")];
  await prisma.user.createMany({
    data: [teacherId, studentA, studentB].map((userId) => ({ id: userId, name: userId, role: "Reader" })),
  });
  await prisma.organization.create({ data: { id: orgId, name: "Org", slug: orgId } });
  await prisma.classroom.create({ data: { id: classroomId, orgId, name: "Class", teacherId } });
  await prisma.classroomMembership.createMany({
    data: [studentA, studentB].map((userId) => ({ classroomId, userId, role: "Student" as const })),
  });
  const { articleId, questions } = await createArticleWithQuiz("rs_matrix");
  await prisma.assignment.create({ data: { classroomId, articleId } });

  await recordQuizAttempt(studentA, articleId, 0, 2, { answers: graded(questions, [false, false]) });
  await new Promise((resolve) => setTimeout(resolve, 10));
  await recordQuizAttempt(studentA, articleId, 2, 2, { answers: graded(questions, [true, true]) });
  await recordQuizAttempt(studentB, articleId, 1, 2, { answers: graded(questions, [true, false]) });

  const matrix = await getClassroomSkillMatrix(classroomId, { individual: true });
  assert.equal(matrix.attemptCount, 2);
  assert.deepEqual(matrix.classTotals.main_idea, { correct: 2, total: 2 });
  assert.deepEqual(matrix.classTotals.vocabulary_in_context, { correct: 1, total: 2 });
  const a = matrix.students?.find((student) => student.studentId === studentA);
  assert.deepEqual(a?.cells.vocabulary_in_context, { correct: 1, total: 1 }, "the retake replaces the first attempt");
});

test("browse facets filter on maturity band and quiz skills in PostgreSQL", { skip: !enabled }, async () => {
  requirePostgres();
  const elementary = await createArticleWithQuiz("rs_facet_elem", "elementary");
  const high = await createArticleWithQuiz("rs_facet_high", "high_school");
  const noQuizId = id("rs_facet_noquiz");
  await prisma.article.create({
    data: { id: noQuizId, title: "No quiz", content: "<p>x</p>", status: ArticleStatus.PUBLISHED },
  });
  const ids = [elementary.articleId, high.articleId, noQuizId];

  const match = async (facets: Parameters<typeof articleFacetFilters>[0]) =>
    (
      await prisma.article.findMany({
        where: { id: { in: ids }, AND: articleFacetFilters(facets) },
        select: { id: true },
        orderBy: { id: "asc" },
      })
    ).map((row) => row.id);

  assert.deepEqual(await match({ maturityBand: "middle_school" }), [elementary.articleId, noQuizId].sort());
  assert.deepEqual(await match({ skill: "vocabulary_in_context" }), [elementary.articleId, high.articleId].sort());
  assert.deepEqual(await match({ skill: "argument" }), []);
  assert.deepEqual(await match({ maturityBand: "elementary", skill: "main_idea" }), [elementary.articleId]);
});
