/**
 * Reading progress — forward-only, race-safe progress writes.
 *
 * Re-exports the full public API from the focused engagement/progress
 * sub-module. The implementation lives there so the progress service and
 * the activity side-effect have an explicit, visible dependency boundary.
 */

export {
  COMPLETION_THRESHOLD,
  clampPercent,
  getProgress,
  getProgressMap,
  getProgressSummaries,
  listInProgressArticles,
  saveProgress,
} from "@/lib/engagement/progress";
export type { ProgressSummary, InProgressEntry } from "@/lib/engagement/progress";
