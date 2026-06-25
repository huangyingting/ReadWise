/**
 * Reading-activity tracking and streak calculation (US-M6).
 *
 * Re-exports the public API from the focused engagement sub-modules:
 *   engagement/time.ts        — dateKey, localDayStart
 *   engagement/heatmap.ts     — HeatCell, heatLevel, buildHeatmapCells
 *   engagement/streak.ts      — DayActivity, StreakSummary, getStreakSummary
 *   engagement/activity.ts    — recordReadingActivity
 *   engagement/heatmap-repo.ts — getActivityHeatmap
 *
 * All original exports remain stable so existing consumers continue to work
 * without import changes.
 */

export { dateKey, localDayStart } from "@/lib/engagement/time";
export type { HeatCell } from "@/lib/engagement/heatmap";
export { heatLevel, buildHeatmapCells } from "@/lib/engagement/heatmap";
export { recordReadingActivity } from "@/lib/engagement/activity";
export type { DayActivity, StreakSummary } from "@/lib/engagement/streak";
export { getStreakSummary } from "@/lib/engagement/streak";
export { getActivityHeatmap } from "@/lib/engagement/heatmap-repo";
