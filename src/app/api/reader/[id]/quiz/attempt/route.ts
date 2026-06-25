import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { recordQuizAttempt } from "@/lib/learning/quiz-mastery";
import { getOrCreateArticleQuiz } from "@/lib/quiz";
import { gradeQuizAnswers } from "@/lib/quiz-grading";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { updateArticleMastery } from "@/lib/learning/article-mastery";
import { recordSkillEvidence } from "@/lib/learning/skill-mastery";
import { bestEffortMastery } from "@/lib/learning/primitives";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import { quizAttemptBody } from "@/lib/reader/schemas";

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
  { params: idParams, body: quizAttemptBody },
  async ({ req, params, body, session }) => {
    const { article, context } = await requireReadableArticle(params.id, session.user);

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

    // Product analytics (RW-051): quiz completion is a core engagement signal.
    // Metadata only — only the server-derived score/counts, never quiz content.
    await recordEvent({
      type: ANALYTICS_EVENT_TYPES.quizComplete,
      userId: session.user.id,
      articleId: article.id,
      properties: {
        scorePct: result.attempt.scorePct,
        correctCount: result.attempt.correctCount,
        totalQuestions: result.attempt.totalQuestions,
      },
    });

    return NextResponse.json(result);
  },
);
