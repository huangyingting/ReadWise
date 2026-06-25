/**
 * Progress view model — typed data shape for the progress page (REF-059).
 *
 * Centralises all data loading and derivation so the page component becomes a
 * thin composition root, and section components can be rendered with fixture
 * data without database access.
 */
import type { LearnerAnalytics } from "@/lib/learner-analytics";
import type { HeatCell } from "@/lib/activity";
import { getLearnerAnalytics } from "@/lib/analytics/learner";
import { getActivityHeatmap } from "@/lib/activity";
import { getLevelHistory, getCurrentLevel } from "@/lib/progress-helpers";
import { getReadingSpeedStats } from "@/lib/reading-speed-stats";

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
  hasAnyData: boolean;
  sparkLabel: string;
}

export async function loadProgressViewModel(userId: string): Promise<ProgressViewModel> {
  const [analytics, heatmapCells, levelHistory, currentLevel, speedStats] = await Promise.all([
    getLearnerAnalytics(userId),
    getActivityHeatmap(userId),
    getLevelHistory(userId),
    getCurrentLevel(userId),
    getReadingSpeedStats(userId),
  ]);

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
    hasAnyData,
    sparkLabel,
  };
}
