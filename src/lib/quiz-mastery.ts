/**
 * Quiz mastery & history (M14).
 *
 * Adds per-user attempt persistence on top of the existing per-article
 * QuizQuestion AI cache. The cache + quiz grading flow are UNCHANGED; this
 * module only records completed attempts and surfaces aggregated stats.
 */

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuizAttemptRecord = {
  id: string;
  correctCount: number;
  totalQuestions: number;
  scorePct: number;
  completedAt: Date;
};

export type ArticleQuizHistory = {
  attempts: QuizAttemptRecord[]; // newest first
  best: number | null; // best scorePct across all attempts
  lastScore: number | null; // scorePct of the most recent attempt
  attemptCount: number;
};

export type TrendPoint = {
  completedAt: Date; // use as x-axis label on the client
  scorePct: number;
};

export type QuizMastery = {
  totalAttempts: number;
  articlesQuizzed: number; // distinct articleIds
  averageScore: number | null; // null when totalAttempts === 0
  recentTrend: TrendPoint[]; // last ≤10 attempts, oldest→newest (sparkline)
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Computes a 0–100 integer score from raw counts. */
function computeScorePct(correctCount: number, totalQuestions: number): number {
  return Math.round((correctCount / totalQuestions) * 100);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persists a quiz attempt for a user+article. Validates that counts are
 * sensible (0 <= correctCount <= totalQuestions, totalQuestions > 0), then
 * writes the row and returns the created attempt together with the user's
 * all-time best scorePct for that article.
 *
 * Throws a plain `Error` with a human-readable message on invalid input so
 * the route can map it to a 400.
 */
export async function recordQuizAttempt(
  userId: string,
  articleId: string,
  correctCount: number,
  totalQuestions: number,
): Promise<{ attempt: QuizAttemptRecord; best: number }> {
  if (
    !Number.isInteger(totalQuestions) ||
    totalQuestions <= 0 ||
    !Number.isInteger(correctCount) ||
    correctCount < 0 ||
    correctCount > totalQuestions
  ) {
    throw new Error(
      "correctCount must be 0–totalQuestions and totalQuestions must be > 0",
    );
  }

  const scorePct = computeScorePct(correctCount, totalQuestions);

  const attempt = await prisma.quizAttempt.create({
    data: { userId, articleId, correctCount, totalQuestions, scorePct },
    select: {
      id: true,
      correctCount: true,
      totalQuestions: true,
      scorePct: true,
      completedAt: true,
    },
  });

  // Best score across all attempts for this article (including the new one).
  const agg = await prisma.quizAttempt.aggregate({
    where: { userId, articleId },
    _max: { scorePct: true },
  });
  const best = agg._max.scorePct ?? scorePct;

  return { attempt, best };
}

/**
 * Returns per-article quiz history for a single user. Ownership is enforced
 * by the `userId` filter — no IDOR possible.
 */
export async function getArticleQuizHistory(
  userId: string,
  articleId: string,
): Promise<ArticleQuizHistory> {
  const rows = await prisma.quizAttempt.findMany({
    where: { userId, articleId },
    orderBy: { completedAt: "desc" },
    select: {
      id: true,
      correctCount: true,
      totalQuestions: true,
      scorePct: true,
      completedAt: true,
    },
  });

  const best = rows.length > 0 ? Math.max(...rows.map((r) => r.scorePct)) : null;
  const lastScore = rows.length > 0 ? rows[0].scorePct : null;

  return {
    attempts: rows,
    best,
    lastScore,
    attemptCount: rows.length,
  };
}

/**
 * Returns overall comprehension mastery for a user.
 *
 * Uses two targeted queries (no N+1):
 *   1. An aggregate for totalAttempts + averageScore.
 *   2. A `groupBy` for distinct articlesQuizzed.
 *   3. A `findMany` limited to 10 for the sparkline trend.
 */
export async function getQuizMastery(userId: string): Promise<QuizMastery> {
  const [agg, distinctRows, trendRows] = await Promise.all([
    prisma.quizAttempt.aggregate({
      where: { userId },
      _count: { id: true },
      _avg: { scorePct: true },
    }),
    prisma.quizAttempt.groupBy({
      by: ["articleId"],
      where: { userId },
      _count: { articleId: true },
    }),
    prisma.quizAttempt.findMany({
      where: { userId },
      orderBy: { completedAt: "desc" },
      take: 10,
      select: { completedAt: true, scorePct: true },
    }),
  ]);

  const totalAttempts = agg._count.id;
  const articlesQuizzed = distinctRows.length;
  const averageScore =
    totalAttempts > 0 && agg._avg.scorePct !== null
      ? Math.round(agg._avg.scorePct)
      : null;

  // Reverse so the sparkline goes oldest→newest
  const recentTrend: TrendPoint[] = trendRows
    .reverse()
    .map((r) => ({ completedAt: r.completedAt, scorePct: r.scorePct }));

  return { totalAttempts, articlesQuizzed, averageScore, recentTrend };
}
