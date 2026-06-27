/**
 * Progress view model — typed data shape for the progress page (REF-059).
 *
 * Centralises all data loading and derivation so the page component becomes a
 * thin composition root, and section components can be rendered with fixture
 * data without database access.
 */
import type { LearnerAnalytics } from "@/lib/analytics/learner";
import type { HeatCell, FluencyTrend } from "@/lib/engagement";
import { getLearnerAnalytics } from "@/lib/analytics/learner";
import { getActivityHeatmap, getReadingSpeedStats, getFluencyTrend } from "@/lib/engagement";
import { getLevelHistory, getCurrentLevel } from "@/lib/progress-helpers";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";

export type { LearnerAnalytics };

export interface ProgressSpeedStats {
  averageWpm: number | null;
  recentWpm: number | null;
  sessionCount: number;
}

export interface ProgressViewModel {
  analytics: LearnerAnalytics;
  heatmapCells: HeatCell[];
  levelHistory: Awaited<ReturnType<typeof getLevelHistory>>;
  currentLevel: Awaited<ReturnType<typeof getCurrentLevel>>;
  speedStats: ProgressSpeedStats;
  fluencyTrend: FluencyTrend;
  hasAnyData: boolean;
  sparkLabel: string;
}

export async function loadProgressViewModel(userId: string): Promise<ProgressViewModel> {
  const [analytics, heatmapCells, levelHistory, currentLevel, speedStats, fluencyTrend] =
    await Promise.all([
      getLearnerAnalytics(userId),
      getActivityHeatmap(userId),
      getLevelHistory(userId),
      getCurrentLevel(userId),
      getReadingSpeedStats(userId),
      getFluencyTrend(userId),
    ]);

  // #813 — record that the learner viewed their fluency trend. Metadata only:
  // the controlled trend enum, the sample COUNT, and the optional level filter.
  // NEVER any WPM value or article content.
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.fluencyTrendViewed,
    userId,
    properties: {
      trend: fluencyTrend.trend,
      sampleCount: fluencyTrend.sampleCount,
      levelFilter: fluencyTrend.levelFilter,
    },
  });

  const { totalCompleted, totalInProgress, totalSavedWords, totalQuizAttempts, quizScoreTrend } =
    analytics;

  const hasAnyData = totalCompleted + totalInProgress + totalSavedWords + totalQuizAttempts > 0;

  const sparkLabel =
    quizScoreTrend.length > 0
      ? `Recent quiz scores oldest to newest: ${quizScoreTrend.join(", ")} percent.`
      : "No quiz attempts yet.";

  return {
    analytics,
    heatmapCells,
    levelHistory,
    currentLevel,
    speedStats,
    fluencyTrend,
    hasAnyData,
    sparkLabel,
  };
}
