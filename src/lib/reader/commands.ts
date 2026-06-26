/**
 * Reader domain write commands (REF-685 / ADR-0010 §5).
 *
 * Encapsulates Prisma mutations and multi-step business logic so route
 * handlers remain thin protocol adapters.
 */
import { prisma } from "@/lib/prisma";
import type { VoteValue } from "@/lib/reader/schemas";

export type DifficultyVoteCounts = {
  vote: VoteValue;
  tooEasy: number;
  justRight: number;
  tooHard: number;
  total: number;
};

/**
 * Upserts a user's difficulty vote for an article and returns the updated
 * aggregate distribution.  One vote per user per article (upsert semantics).
 */
export async function submitDifficultyVote(
  userId: string,
  articleId: string,
  vote: VoteValue,
): Promise<DifficultyVoteCounts> {
  await prisma.articleDifficultyFeedback.upsert({
    where: { userId_articleId: { userId, articleId } },
    create: { userId, articleId, vote },
    update: { vote },
  });

  const all = await prisma.articleDifficultyFeedback.findMany({
    where: { articleId },
    select: { vote: true },
  });

  const counts = { tooEasy: 0, justRight: 0, tooHard: 0 };
  for (const row of all) {
    if (row.vote === "too_easy") counts.tooEasy++;
    else if (row.vote === "just_right") counts.justRight++;
    else if (row.vote === "too_hard") counts.tooHard++;
  }

  return { vote, ...counts, total: all.length };
}
