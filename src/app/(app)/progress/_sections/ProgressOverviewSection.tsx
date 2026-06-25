/**
 * ProgressOverviewSection — grid of stat cards showing totals and key metrics
 * (REF-059).
 */
import { TrendingUp, BookOpen, Zap, Star, Brain, BookMarked } from "lucide-react";
import { StatCard } from "@/components/analytics/StatCard";
import type { LearnerAnalytics } from "@/lib/analytics/learner";
import type { ProgressSpeedStats } from "@/app/(app)/progress/view-model";

interface ProgressOverviewSectionProps {
  analytics: LearnerAnalytics;
  speedStats: ProgressSpeedStats;
}

export function ProgressOverviewSection({
  analytics,
  speedStats,
}: ProgressOverviewSectionProps) {
  const {
    totalCompleted,
    totalInProgress,
    totalSavedWords,
    totalQuizAttempts,
    averageQuizScore,
    currentStreak,
    longestStreak,
  } = analytics;

  return (
    <section aria-labelledby="overview-h">
      <h2
        id="overview-h"
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mb-[var(--space-4)]"
      >
        Overview
      </h2>
      <div className="grid grid-cols-2 gap-[var(--space-4)] sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          icon={BookOpen}
          label="Articles completed"
          value={totalCompleted}
          color="var(--teal)"
        />
        <StatCard
          icon={BookMarked}
          label="In progress"
          value={totalInProgress}
          color="var(--primary)"
        />
        <StatCard
          icon={Brain}
          label="Words saved"
          value={totalSavedWords}
          color="var(--stat-vocab)"
        />
        <StatCard
          icon={Zap}
          label="Current streak"
          value={`${currentStreak}d`}
          sub={`Best: ${longestStreak} day${longestStreak !== 1 ? "s" : ""}`}
          color="var(--stat-streak)"
        />
        {averageQuizScore !== null && (
          <StatCard
            icon={Star}
            label="Avg quiz score"
            value={`${averageQuizScore}%`}
            sub={`${totalQuizAttempts} attempt${totalQuizAttempts !== 1 ? "s" : ""}`}
            color="var(--stat-quiz)"
          />
        )}
        {speedStats.averageWpm !== null && (
          <StatCard
            icon={TrendingUp}
            label="Reading speed"
            value={`${speedStats.averageWpm} wpm`}
            sub={
              speedStats.recentWpm !== null && speedStats.recentWpm !== speedStats.averageWpm
                ? `Recent: ${speedStats.recentWpm} wpm (${speedStats.recentWpm > speedStats.averageWpm ? "↑ faster" : "↓ slower"})`
                : `${speedStats.sessionCount} session${speedStats.sessionCount !== 1 ? "s" : ""}`
            }
            color="var(--primary)"
          />
        )}
      </div>
    </section>
  );
}
