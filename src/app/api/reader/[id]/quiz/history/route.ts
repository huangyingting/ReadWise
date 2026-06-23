import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getArticleQuizHistory } from "@/lib/quiz-mastery";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";

/**
 * GET /api/reader/[id]/quiz/history
 *
 * Returns the authenticated user's quiz attempt history for a single article.
 * Ownership is enforced: a user can only see their own attempts.
 *
 * Response 200: {
 *   attempts: [{ id, correctCount, totalQuestions, scorePct, completedAt }], // newest first
 *   best: number | null,
 *   lastScore: number | null,
 *   attemptCount: number,
 * }
 * Errors: 401 unauthenticated | 404 article not found
 */
export const GET = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const article = await getReadableArticleById(params.id, articleAccessContext(session.user));
    if (!article) {
      throw new ApiError(404, "Article not found");
    }

    const history = await getArticleQuizHistory(session.user.id, article.id);
    return NextResponse.json(history);
  },
);
