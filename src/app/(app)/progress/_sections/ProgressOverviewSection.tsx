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

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function formatReadingSpeedSub(speedStats: ProgressSpeedStats) {
  const { averageWpm, recentWpm, sessionCount } = speedStats;
  if (recentWpm !== null && recentWpm !== averageWpm) {
    return `Recent: ${recentWpm} wpm (${recentWpm > (averageWpm ?? 0) ? "↑ faster" : "↓ slower"})`;
  }

  return `${sessionCount} ${pluralize(sessionCount, "session")}`;
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

  const streakSub = `Best: ${longestStreak} ${pluralize(longestStreak, "day")}`;
  const quizAttemptSub = `${totalQuizAttempts} ${pluralize(totalQuizAttempts, "attempt")}`;

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
          sub={streakSub}
          color="var(--stat-streak)"
        />
        {averageQuizScore !== null && (
          <StatCard
            icon={Star}
            label="Avg quiz score"
            value={`${averageQuizScore}%`}
            sub={quizAttemptSub}
            color="var(--stat-quiz)"
          />
        )}
        {speedStats.averageWpm !== null && (
          <StatCard
            icon={TrendingUp}
            label="Reading speed"
            value={`${speedStats.averageWpm} wpm`}
            sub={formatReadingSpeedSub(speedStats)}
            color="var(--primary)"
          />
        )}
      </div>
    </section>
  );
}
