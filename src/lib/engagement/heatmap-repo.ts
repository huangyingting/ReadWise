/**
 * Heatmap repository for the engagement subsystem.
 *
 * Fetches DailyActivity rows from the database and delegates all cell
 * generation to the pure buildHeatmapCells helper so the computation
 * remains independently testable.
 */

import { prisma } from "@/lib/prisma";
import { buildHeatmapCells, type HeatCell } from "./heatmap";

/**
 * Returns a 365-cell (52-week + today) heatmap for the given user.
 * Query is bounded to the last 53 weeks for safety.
 */
export async function getActivityHeatmap(userId: string): Promise<HeatCell[]> {
  const fiftyThreeWeeksAgo = new Date(Date.now() - 53 * 7 * 86_400_000);
  const rows = await prisma.dailyActivity.findMany({
    where: { userId, date: { gte: fiftyThreeWeeksAgo } },
    select: { date: true, articlesRead: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.date.toISOString().slice(0, 10), r.articlesRead);
  }
  return buildHeatmapCells(map);
}
