import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { updateArticleMastery } from "@/lib/learning/article-mastery";
import { bestEffortMastery } from "@/lib/learning/primitives";
import { difficultyFeedbackBody, type VoteValue } from "@/lib/reader/schemas";
import { submitDifficultyVote } from "@/lib/reader/commands";

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

    // Best-effort: difficulty feedback influences article mastery.
    await bestEffortMastery("difficulty.article_mastery", () =>
      updateArticleMastery(session.user.id, params.id),
    );

    return NextResponse.json(result);
  },
);
