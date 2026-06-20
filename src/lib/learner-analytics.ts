/**
 * Learner-facing analytics (Issue #18).
 *
 * All queries are scoped to a single userId — no data from other users is
 * ever returned. Aggregations use targeted Prisma queries (no N+1).
 */

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WeekBucket = {
  /** ISO YYYY-[W]WW label, e.g. "2025-W23". */
  week: string;
  count: number;
};

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
// Helpers
// ---------------------------------------------------------------------------

/** ISO year+week string e.g. "2025-W03" for any Date. */
function isoWeek(d: Date): string {
  // Use the Thursday-based ISO week calculation
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/** Produce a zero-filled series of weekly buckets for the last N weeks. */
function lastNWeeks(n: number): WeekBucket[] {
  const buckets: WeekBucket[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 86_400_000);
    buckets.push({ week: isoWeek(d), count: 0 });
  }
  return buckets;
}

/** Merge raw date+count pairs into pre-built weekly buckets. */
function fillWeekBuckets(
  buckets: WeekBucket[],
  rows: { date: Date; count: number }[],
): WeekBucket[] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(isoWeek(r.date), (map.get(isoWeek(r.date)) ?? 0) + r.count);
  return buckets.map((b) => ({ ...b, count: map.get(b.week) ?? 0 }));
}

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
    activityRows,
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
    }),

    // Streak: all daily activity
    prisma.dailyActivity.findMany({
      where: { userId },
      orderBy: { date: "asc" },
      select: { date: true, articlesRead: true },
    }),
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

  // --- streaks (mirrors activity.ts logic) ---
  const activeDates = new Set<string>();
  for (const a of activityRows) {
    if (a.articlesRead > 0) {
      activeDates.add(a.date.toISOString().slice(0, 10));
    }
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  let currentStreak = 0;
  const anchor = activeDates.has(todayStr)
    ? todayStr
    : activeDates.has(yesterdayStr)
      ? yesterdayStr
      : null;
  if (anchor) {
    let cursor = new Date(anchor + "T00:00:00Z");
    while (activeDates.has(cursor.toISOString().slice(0, 10))) {
      currentStreak++;
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
  }

  let longestStreak = 0;
  let run = 0;
  let prevMs: number | null = null;
  for (const key of [...activeDates].sort()) {
    const ms = new Date(key + "T00:00:00Z").getTime();
    run = prevMs !== null && ms - prevMs === 86_400_000 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prevMs = ms;
  }

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
