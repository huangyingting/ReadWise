import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams, object, oneOf } from "@/lib/validation";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { prisma } from "@/lib/prisma";
import { updateArticleMastery } from "@/lib/article-mastery";
import { bestEffortMastery } from "@/lib/mastery";

const VOTE_VALUES = ["too_easy", "just_right", "too_hard"] as const;
type VoteValue = (typeof VOTE_VALUES)[number];

const bodySchema = object({ vote: oneOf(VOTE_VALUES) });

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
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    await requireReadableArticle(params.id, session.user);

    const vote = body.vote as VoteValue;

    // Upsert — one vote per user per article.
    await prisma.articleDifficultyFeedback.upsert({
      where: { userId_articleId: { userId: session.user.id, articleId: params.id } },
      create: { userId: session.user.id, articleId: params.id, vote },
      update: { vote },
    });

    // Best-effort: difficulty feedback influences article mastery.
    await bestEffortMastery("difficulty.article_mastery", () =>
      updateArticleMastery(session.user.id, params.id),
    );

    // Return aggregate counts.
    const all = await prisma.articleDifficultyFeedback.findMany({
      where: { articleId: params.id },
      select: { vote: true },
    });

    const counts = { tooEasy: 0, justRight: 0, tooHard: 0 };
    for (const row of all) {
      if (row.vote === "too_easy") counts.tooEasy++;
      else if (row.vote === "just_right") counts.justRight++;
      else if (row.vote === "too_hard") counts.tooHard++;
    }

    return NextResponse.json({
      vote,
      ...counts,
      total: all.length,
    });
  },
);
