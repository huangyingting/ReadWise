/**
 * Learner-facing analytics (Issue #18).
 *
 * All queries are scoped to a single userId — no data from other users is
 * ever returned. Aggregations use targeted Prisma queries (no N+1).
 */

import { prisma } from "@/lib/prisma";
import { getStreakSummary } from "@/lib/activity";
import {
  fillWeekBuckets,
  isoWeek,
  lastNWeeks,
  type WeekBucket,
} from "@/lib/aggregation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LevelBucket = {
  level: string; // CEFR string or "Unknown"
  count: number;
};

export type LearnerAnalytics = {
  /** Overall totals */
  totalCompleted: number;
  totalInProgress: number;
  totalSavedWords: number;
  totalQuizAttempts: number;
  averageQuizScore: number | null;

  /** Reading completions by week for the last 12 weeks (oldest → newest). */
  completionsByWeek: WeekBucket[];

  /** Vocabulary saved by week for the last 12 weeks (oldest → newest). */
  wordsByWeek: WeekBucket[];

  /** Quiz score trend — last 10 attempts, oldest → newest. */
  quizScoreTrend: number[];

  /** Distribution of completed articles by difficulty (CEFR). */
  completedByLevel: LevelBucket[];

  /** Streak data */
  currentStreak: number;
  longestStreak: number;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getLearnerAnalytics(userId: string): Promise<LearnerAnalytics> {
  const twelveWeeksAgo = new Date(Date.now() - 12 * 7 * 86_400_000);

  const [
    progressStats,
    completedRows,
    savedWordsTotal,
    recentWords,
    quizAgg,
    recentQuizAttempts,
    completedWithLevel,
    streakSummary,
  ] = await Promise.all([
    // Total completed + in-progress
    prisma.readingProgress.groupBy({
      by: ["completed"],
      where: { userId },
      _count: { id: true },
    }),

    // Completed articles + their completedAt for weekly bucketing
    prisma.readingProgress.findMany({
      where: { userId, completed: true, completedAt: { gte: twelveWeeksAgo } },
      select: { completedAt: true },
    }),

    // Total saved words
    prisma.savedWord.count({ where: { userId } }),

    // Recently saved words for weekly bucketing
    prisma.savedWord.findMany({
      where: { userId, createdAt: { gte: twelveWeeksAgo } },
      select: { createdAt: true },
    }),

    // Quiz aggregate
    prisma.quizAttempt.aggregate({
      where: { userId },
      _count: { id: true },
      _avg: { scorePct: true },
    }),

    // Recent quiz attempts for sparkline
    prisma.quizAttempt.findMany({
      where: { userId },
      orderBy: { completedAt: "desc" },
      take: 10,
      select: { scorePct: true },
    }),

    // Completed article difficulties
    prisma.readingProgress.findMany({
      where: { userId, completed: true },
      select: { article: { select: { difficulty: true } } },
      take: 1000,
    }),

    // Streak summary computed in the user's timezone (delegated to the shared
    // activity helper so streak/day-boundary logic is not re-implemented here).
    getStreakSummary(userId),
  ]);

  // --- totals ---
  const totalCompleted = progressStats.find((g) => g.completed)
    ?._count.id ?? 0;
  const totalInProgress = progressStats.find((g) => !g.completed)
    ?._count.id ?? 0;

  // --- weekly completions ---
  const weekBuckets = lastNWeeks(12);
  const completionsByWeek = fillWeekBuckets(
    weekBuckets,
    completedRows
      .filter((r) => r.completedAt !== null)
      .map((r) => ({ date: r.completedAt as Date, count: 1 })),
  );

  // --- weekly vocabulary ---
  const wordsByWeek = fillWeekBuckets(
    lastNWeeks(12),
    recentWords.map((r) => ({ date: r.createdAt, count: 1 })),
  );

  // --- quiz ---
  const totalQuizAttempts = quizAgg._count.id;
  const averageQuizScore =
    totalQuizAttempts > 0 && quizAgg._avg.scorePct !== null
      ? Math.round(quizAgg._avg.scorePct)
      : null;
  const quizScoreTrend = [...recentQuizAttempts].reverse().map((r) => r.scorePct);

  // --- level distribution ---
  const levelMap = new Map<string, number>();
  for (const row of completedWithLevel) {
    const key = row.article.difficulty ?? "Unknown";
    levelMap.set(key, (levelMap.get(key) ?? 0) + 1);
  }
  const completedByLevel: LevelBucket[] = [...levelMap.entries()]
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => a.level.localeCompare(b.level));

  // --- streaks (timezone-aware, via getStreakSummary) ---
  const { currentStreak, longestStreak } = streakSummary;

  return {
    totalCompleted,
    totalInProgress,
    totalSavedWords: savedWordsTotal,
    totalQuizAttempts,
    averageQuizScore,
    completionsByWeek,
    wordsByWeek,
    quizScoreTrend,
    completedByLevel,
    currentStreak,
    longestStreak,
  };
}
