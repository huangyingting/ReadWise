/**
 * Pure heatmap helpers for the engagement subsystem.
 *
 * No Prisma dependency — safe to import in pure-function tests.
 */

import { dateKey, localDayStart } from "./time";

export type HeatCell = {
  /** YYYY-MM-DD */
  date: string;
  /** raw articles read on this day */
  count: number;
  /** 0–4 heat level (0 = no activity) */
  level: 0 | 1 | 2 | 3 | 4;
};

/**
 * Compute a 0–4 heat level from an article count.
 * Thresholds: 0 → 0, 1 → 1, 2–3 → 2, 4–5 → 3, 6+ → 4.
 */
export function heatLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

/**
 * Build a fully-populated 52-week (364 + today = 365 cell) heatmap grid
 * from a sparse map of date → articlesRead.
 *
 * @param activityMap - Sparse map of YYYY-MM-DD → article count.
 * @param todayStr    - Today's date string YYYY-MM-DD. Defaults to UTC today.
 */
export function buildHeatmapCells(
  activityMap: Map<string, number>,
  todayStr?: string,
): HeatCell[] {
  const today = todayStr
    ? new Date(todayStr + "T00:00:00Z")
    : localDayStart();
  const cells: HeatCell[] = [];
  // 364 days back (= 52 weeks) + today = 365 cells
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = dateKey(d);
    const count = activityMap.get(key) ?? 0;
    cells.push({ date: key, count, level: heatLevel(count) });
  }
  return cells;
}
