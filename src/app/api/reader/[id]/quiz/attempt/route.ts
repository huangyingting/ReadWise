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
import { quizAttemptBody, type QuizAttemptBody } from "@/lib/reader/schemas";
import { markTodayComprehensionComplete } from "@/lib/engagement/today-session/integrations";

type QuizAttemptResult = Awaited<ReturnType<typeof recordQuizAttempt>>;
type QuizAttemptRecord = QuizAttemptResult["attempt"];

function badAttemptRequest(err: unknown, fallback: string): ApiError {
  return new ApiError(400, err instanceof Error ? err.message : fallback);
}

function clientMutationIdFrom(body: QuizAttemptBody, req: Request): string | null {
  return body.clientMutationId ?? req.headers.get("x-client-mutation-id") ?? null;
}

async function updateQuizMasterySignals(
  userId: string,
  articleId: string,
  score: number,
): Promise<void> {
  await Promise.all([
    bestEffortMastery("quiz.article_mastery", () =>
      updateArticleMastery(userId, articleId),
    ),
    bestEffortMastery("quiz.comprehension_skill", () =>
      recordSkillEvidence(userId, "comprehension", score),
    ),
    bestEffortMastery("quiz.reading_skill", () =>
      recordSkillEvidence(userId, "reading", score, 0.5),
    ),
  ]);
}

async function recordQuizCompletionEvent(
  userId: string,
  articleId: string,
  attempt: QuizAttemptRecord,
): Promise<void> {
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.quizComplete,
    userId,
    articleId,
    properties: {
      scorePct: attempt.scorePct,
      correctCount: attempt.correctCount,
      totalQuestions: attempt.totalQuestions,
    },
  });
}

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
      throw badAttemptRequest(err, "Invalid answers");
    }

    const clientMutationId = clientMutationIdFrom(body, req);

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
      throw badAttemptRequest(err, "Invalid attempt data");
    }

    // Best-effort mastery side-effects — never break the attempt write. A quiz
    // is the strongest comprehension signal; it also feeds reading.
    const score = result.attempt.scorePct / 100;
    await updateQuizMasterySignals(session.user.id, article.id, score);

    // Product analytics (RW-051): quiz completion is a core engagement signal.
    // Metadata only — only the server-derived score/counts, never quiz content.
    await recordQuizCompletionEvent(session.user.id, article.id, result.attempt);

    // Best-effort: a quiz attempt on today's primary article completes the
    // Today comprehension step. Never breaks the attempt write.
    await bestEffortMastery("quiz.today_comprehension", () =>
      markTodayComprehensionComplete({
        userId: session.user.id,
        articleId: article.id,
      }),
    );

    return NextResponse.json(result);
  },
);
