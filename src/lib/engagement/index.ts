/**
 * Engagement subsystem — public barrel.
 *
 * Ownership:
 *   - streak/time/activity engagement state
 *   - progress read models for listing/dashboard surfaces
 *   - heatmap + fluency read models
 *
 * This barrel intentionally exports only cross-domain read services and types
 * consumed outside `@/lib/engagement/**`. Feature-specific internals stay on
 * their direct submodule paths.
 */

export type { HeatCell } from "./heatmap";
export { getActivityHeatmap } from "./heatmap-repo";
export { getStreakSummary } from "./streak";
export type { StreakSummary } from "./streak";
export {
  getProgress,
  getProgressMap,
  getProgressSummaries,
  listInProgressArticles,
} from "./progress";
export type { ProgressSummary, InProgressEntry } from "./progress";
export type { FluencyTrend, FluencyTrendValue } from "./reading-speed";
export {
  getReadingSpeedStats,
  getFluencyTrend,
} from "./reading-speed-repo";
