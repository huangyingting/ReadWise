/**
 * Reading speed stats — DB helper for the progress page (#378).
 *
 * Kept separate from reading-speed.ts (pure functions) so that the pure
 * computation logic can be tested without mocking Prisma.
 */

import { prisma } from "@/lib/prisma";
import { computeWpmTrend, type SpeedRecord } from "@/lib/reading-speed";

/**
 * Fetches the user's reading-speed stats from their ArticleMastery records.
 *
 * Returns a trend object (averageWpm / recentWpm) ready to display on the
 * progress page, or nulls when not enough data is available yet.
 *
 * Only records that have BOTH a `timeSpentMs` > 0 AND an article with a
 * positive `wordCount` are included in the computation.
 */
export async function getReadingSpeedStats(userId: string): Promise<{
  averageWpm: number | null;
  recentWpm: number | null;
  sessionCount: number;
}> {
  const rows = await prisma.articleMastery.findMany({
    where: {
      userId,
      timeSpentMs: { gt: 0 },
      article: { wordCount: { gt: 0 } },
    },
    select: {
      timeSpentMs: true,
      article: { select: { wordCount: true } },
    },
    orderBy: { lastActivityAt: "asc" },
    take: 50,
  });

  const records: SpeedRecord[] = rows
    .filter((r) => r.timeSpentMs != null && r.article.wordCount != null)
    .map((r) => ({
      wordCount: r.article.wordCount as number,
      timeSpentMs: r.timeSpentMs as number,
    }));

  const trend = computeWpmTrend(records);
  return { ...trend, sessionCount: records.length };
}
