import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, number, array, optional, nonEmptyString } from "@/lib/validation";
import { recordQuizAttempt } from "@/lib/quiz-mastery";
import { getOrCreateArticleQuiz } from "@/lib/quiz";
import { gradeQuizAnswers } from "@/lib/quiz-grading";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";
import { updateArticleMastery } from "@/lib/article-mastery";
import { recordSkillEvidence } from "@/lib/skill-mastery";
import { bestEffortMastery } from "@/lib/mastery";

const bodySchema = object({
  answers: array(
    object({
      index: number({ int: true, min: 0, max: 1000 }),
      selectedIndex: number({ int: true, min: 0, max: 1000 }),
    }),
    { max: 1000 },
  ),
  // RW-042 — optional idempotency key for offline-queued re-syncs (also accepted
  // via the X-Client-Mutation-Id header).
  clientMutationId: optional(nonEmptyString(100)),
});

/**
 * POST /api/reader/[id]/quiz/attempt
 *
 * Records a completed quiz attempt for the authenticated user.
 *
 * The client submits ONLY its selected answer indices — never a self-reported
 * score. Grading is done SERVER-SIDE against the cached `QuizQuestion.correctIndex`
 * rows for the article (the source of truth), so a forged `correctCount` cannot
 * inflate mastery/leveling. The persisted attempt uses the server-derived score.
 *
 * Body: { answers: { index: number, selectedIndex: number }[] }
 * Response 200: { attempt: { id, correctCount, totalQuestions, scorePct, completedAt }, best: number }
 * Errors: 400 invalid/mismatched answers | 401 unauthenticated | 404 article not found
 */
export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ req, params, body, session }) => {
    const context = articleAccessContext(session.user);
    const article = await getReadableArticleById(params.id, context);
    if (!article) {
      throw new ApiError(404, "Article not found");
    }

    // Load the canonical cached quiz (already gated by article access above).
    const quiz = await getOrCreateArticleQuiz(article.id, context);
    if (!quiz || quiz.fallback || quiz.questions.length === 0) {
      throw new ApiError(400, "Quiz is not available for this article");
    }

    // Grade server-side from the real correctIndex values.
    let graded;
    try {
      graded = gradeQuizAnswers(quiz.questions, body.answers);
    } catch (err) {
      throw new ApiError(400, err instanceof Error ? err.message : "Invalid answers");
    }

    const clientMutationId =
      body.clientMutationId ?? req.headers.get("x-client-mutation-id") ?? null;

    let result;
    try {
      result = await recordQuizAttempt(
        session.user.id,
        article.id,
        graded.correctCount,
        graded.total,
        { clientMutationId },
      );
    } catch (err) {
      throw new ApiError(400, err instanceof Error ? err.message : "Invalid attempt data");
    }

    // Best-effort mastery side-effects — never break the attempt write. A quiz
    // is the strongest comprehension signal; it also feeds reading.
    const score = result.attempt.scorePct / 100;
    await Promise.all([
      bestEffortMastery("quiz.article_mastery", () =>
        updateArticleMastery(session.user.id, article.id),
      ),
      bestEffortMastery("quiz.comprehension_skill", () =>
        recordSkillEvidence(session.user.id, "comprehension", score),
      ),
      bestEffortMastery("quiz.reading_skill", () =>
        recordSkillEvidence(session.user.id, "reading", score, 0.5),
      ),
    ]);

    return NextResponse.json(result);
  },
);
