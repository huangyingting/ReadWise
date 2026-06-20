import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, number } from "@/lib/validation";
import { recordQuizAttempt } from "@/lib/quiz-mastery";
import { getViewableArticleById } from "@/lib/articles";

const bodySchema = object({
  correctCount: number({ int: true, min: 0, max: 1000 }),
  totalQuestions: number({ int: true, min: 1, max: 1000 }),
});

/**
 * POST /api/reader/[id]/quiz/attempt
 *
 * Records a completed quiz attempt for the authenticated user.
 *
 * Body: { correctCount: number, totalQuestions: number }
 * Response 200: { attempt: { id, correctCount, totalQuestions, scorePct, completedAt }, best: number }
 * Errors: 400 invalid counts | 401 unauthenticated | 404 article not found
 */
export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    const article = await getViewableArticleById(params.id, session.user.role);
    if (!article) {
      throw new ApiError(404, "Article not found");
    }

    let result;
    try {
      result = await recordQuizAttempt(
        session.user.id,
        article.id,
        body.correctCount,
        body.totalQuestions,
      );
    } catch (err) {
      throw new ApiError(400, err instanceof Error ? err.message : "Invalid attempt data");
    }

    return NextResponse.json(result);
  },
);
