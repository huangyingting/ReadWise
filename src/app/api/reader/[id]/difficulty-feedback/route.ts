import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { updateArticleMastery } from "@/lib/learning/article-mastery";
import { bestEffortMastery } from "@/lib/learning/primitives";
import { difficultyFeedbackBody, type VoteValue } from "@/lib/reader/schemas";
import { submitDifficultyVote } from "@/lib/reader/commands";
import { markTodayComprehensionComplete } from "@/lib/engagement/today-session/integrations";

async function updateMasteryAfterFeedback(userId: string, articleId: string): Promise<void> {
  // Best-effort: difficulty feedback influences article mastery.
  await bestEffortMastery("difficulty.article_mastery", () =>
    updateArticleMastery(userId, articleId),
  );
}

async function completeTodayComprehensionAfterFeedback(
  userId: string,
  articleId: string,
): Promise<void> {
  // Best-effort: difficulty feedback on today's primary article completes the
  // Today comprehension step. Never breaks the feedback write.
  await bestEffortMastery("difficulty.today_comprehension", () =>
    markTodayComprehensionComplete({
      userId,
      articleId,
    }),
  );
}

async function applyDifficultyFeedbackSideEffects(
  userId: string,
  articleId: string,
): Promise<void> {
  await updateMasteryAfterFeedback(userId, articleId);
  await completeTodayComprehensionAfterFeedback(userId, articleId);
}

/**
 * POST /api/reader/[id]/difficulty-feedback
 *
 * Upserts a user's difficulty vote for the article. Returns the aggregate
 * vote distribution so the client can optionally display it.
 *
 * Body: { vote: "too_easy" | "just_right" | "too_hard" }
 * Response: { vote, tooEasy, justRight, tooHard, total }
 */
export const POST = createHandler(
  { params: idParams, body: difficultyFeedbackBody },
  async ({ params, body, session }) => {
    await requireReadableArticle(params.id, session.user);

    const result = await submitDifficultyVote(
      session.user.id,
      params.id,
      body.vote as VoteValue,
    );

    await applyDifficultyFeedbackSideEffects(session.user.id, params.id);

    return NextResponse.json(result);
  },
);
