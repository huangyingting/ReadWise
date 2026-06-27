/**
 * Reading-speed repository for the engagement subsystem.
 *
 * Fetches ArticleMastery rows from the database and delegates all WPM
 * computation to the pure reading-speed helpers, keeping the DB access
 * layer separate from the computation logic.
 */

import { prisma } from "@/lib/prisma";
import {
  computeFluencyTrend,
  computeWpmTrend,
  type FluencyTrend,
  type SpeedRecord,
} from "./reading-speed";

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

/** Default look-back window (days) for an on-demand fluency trend. */
export const FLUENCY_DEFAULT_WINDOW_DAYS = 90;

/**
 * Compute the learner's on-demand reading-fluency trend (#813).
 *
 * Gathers the source `ArticleMastery` rows (optionally narrowed to a CEFR
 * `level` band and/or a topic `category`, within `windowDays`) and delegates
 * the deterministic classification to {@link computeFluencyTrend}. The result is
 * display-only: it is NOT persisted and NOT cached server-side — every call
 * recomputes from the source-of-truth rows.
 *
 * Privacy: the returned object carries only an aggregate average WPM, the
 * controlled trend enum, the sample count, and the applied filters — never any
 * per-article WPM value, article id, title, or other content.
 */
export async function getFluencyTrend(
  userId: string,
  opts: { level?: string | null; category?: string | null; windowDays?: number } = {},
): Promise<FluencyTrend> {
  const level = opts.level ?? null;
  const category = opts.category ?? null;
  const windowDays = opts.windowDays ?? FLUENCY_DEFAULT_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await prisma.articleMastery.findMany({
    where: {
      userId,
      timeSpentMs: { gt: 0 },
      lastActivityAt: { gte: since },
      article: {
        wordCount: { gt: 0 },
        ...(level ? { difficulty: level } : {}),
        ...(category ? { category } : {}),
      },
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

  return computeFluencyTrend(records, { level, category });
}
