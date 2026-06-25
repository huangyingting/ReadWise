/**
 * Reading-speed repository for the engagement subsystem.
 *
 * Fetches ArticleMastery rows from the database and delegates all WPM
 * computation to the pure reading-speed helpers, keeping the DB access
 * layer separate from the computation logic.
 */

import { prisma } from "@/lib/prisma";
import { computeWpmTrend, type SpeedRecord } from "./reading-speed";

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
