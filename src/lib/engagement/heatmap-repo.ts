/**
 * Heatmap repository for the engagement subsystem.
 *
 * Fetches DailyActivity rows from the database and delegates all cell
 * generation to the pure buildHeatmapCells helper so the computation
 * remains independently testable.
 */

import { prisma } from "@/lib/prisma";
import { resolveTimezone } from "@/lib/timezone";
import { buildHeatmapCells, type HeatCell } from "./heatmap";
import { dateKey } from "./time";

const MS_PER_DAY = 86_400_000;
const HEATMAP_LOOKBACK_WEEKS = 53;

type DailyActivityRow = {
  date: Date;
  articlesRead: number;
};

function getLookbackStart(nowMs = Date.now()): Date {
  return new Date(nowMs - HEATMAP_LOOKBACK_WEEKS * 7 * MS_PER_DAY);
}

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toActivityMap(rows: DailyActivityRow[]): Map<string, number> {
  const activityByDate = new Map<string, number>();
  for (const row of rows) {
    activityByDate.set(toDayKey(row.date), row.articlesRead);
  }
  return activityByDate;
}

async function loadProfileTimezone(userId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return profile?.timezone ?? null;
}

/**
 * Returns a 365-cell (52-week + today) heatmap for the given user.
 * Query is bounded to the last 53 weeks for safety.
 */
export async function getActivityHeatmap(
  userId: string,
  opts: { timezone?: string | null; now?: Date } = {},
): Promise<HeatCell[]> {
  const now = opts.now ?? new Date();
  const fiftyThreeWeeksAgo = getLookbackStart(now.getTime());
  const [rows, profileTimezone] = await Promise.all([
    prisma.dailyActivity.findMany({
      where: { userId, date: { gte: fiftyThreeWeeksAgo } },
      select: { date: true, articlesRead: true },
    }),
    loadProfileTimezone(userId),
  ]);
  const timezone = resolveTimezone(opts.timezone, profileTimezone);
  return buildHeatmapCells(toActivityMap(rows), dateKey(now, timezone));
}
