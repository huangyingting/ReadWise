/**
 * Engagement subsystem — public barrel.
 *
 * Re-exports the full public API of all engagement sub-modules so consumers
 * can import from a single entry-point when preferred.
 *
 * Sub-module layout:
 *   time.ts            — pure: dateKey, localDayStart
 *   heatmap.ts         — pure: HeatCell, heatLevel, buildHeatmapCells
 *   streak.ts          — service: StreakSummary, getStreakSummary, shield constants
 *   activity.ts        — service: recordReadingActivity
 *   heatmap-repo.ts    — repo: getActivityHeatmap
 *   progress.ts        — service: saveProgress, getProgress, getProgressMap, …
 *   reading-speed.ts   — pure: computeWpm, computeWpmTrend, …
 *   reading-speed-repo.ts — repo: getReadingSpeedStats
 */

export { dateKey, localDayStart } from "./time";
export type { HeatCell } from "./heatmap";
export { heatLevel, buildHeatmapCells } from "./heatmap";
export {
  SHIELD_EARN_STREAK,
  MAX_SHIELDS,
  getStreakSummary,
} from "./streak";
export type { DayActivity, StreakSummary } from "./streak";
export { recordReadingActivity } from "./activity";
export { getActivityHeatmap } from "./heatmap-repo";
export {
  COMPLETION_THRESHOLD,
  clampPercent,
  getProgress,
  getProgressMap,
  getProgressSummaries,
  listInProgressArticles,
  saveProgress,
} from "./progress";
export type { ProgressSummary, InProgressEntry } from "./progress";
export {
  MIN_ACTIVE_TIME_MS,
  MAX_ACTIVE_TIME_MS,
  MIN_WPM,
  MAX_WPM,
  MIN_FLUENCY_SAMPLES,
  FLUENCY_WINDOW,
  FLUENCY_TREND_DELTA,
  clampActiveTime,
  computeWpm,
  computeWpmTrend,
  computeFluencyTrend,
} from "./reading-speed";
export type { SpeedRecord, FluencyTrend, FluencyTrendValue } from "./reading-speed";
export {
  getReadingSpeedStats,
  getFluencyTrend,
  FLUENCY_DEFAULT_WINDOW_DAYS,
} from "./reading-speed-repo";
