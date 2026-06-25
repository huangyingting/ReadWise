/**
 * Quiz mastery & history (M14).
 *
 * Adds per-user attempt persistence on top of the existing per-article
 * QuizQuestion AI cache. The cache + quiz grading flow are UNCHANGED; this
 * module only records completed attempts and surfaces aggregated stats.
 *
 * Score validation, count-to-percentage computation, idempotency, and
 * TrendPoint are provided by the shared practice-attempts helpers (REF-051).
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  validateCountScore,
  computeCountScorePct,
  findOrCreateIdempotent,
  type TrendPoint,
} from "@/lib/learning/practice-attempts";

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

export type QuizMastery = {
  totalAttempts: number;
  articlesQuizzed: number; // distinct articleIds
  averageScore: number | null; // null when totalAttempts === 0
  recentTrend: TrendPoint[]; // last ≤10 attempts, oldest→newest (sparkline)
};

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
  options: { clientMutationId?: string | null } = {},
): Promise<{ attempt: QuizAttemptRecord; best: number }> {
  validateCountScore(correctCount, totalQuestions);

  const scorePct = computeCountScorePct(correctCount, totalQuestions);
  const clientMutationId = options.clientMutationId?.trim() || null;

  const select = {
    id: true,
    correctCount: true,
    totalQuestions: true,
    scorePct: true,
    completedAt: true,
  } as const;

  // Idempotency (RW-042): a duplicate offline delivery returns the original row.
  const { record: attempt } = await findOrCreateIdempotent({
    clientMutationId,
    find: (id) =>
      prisma.quizAttempt.findUnique({ where: { clientMutationId: id }, select }),
    create: () =>
      prisma.quizAttempt.create({
        data: { userId, articleId, correctCount, totalQuestions, scorePct, clientMutationId },
        select,
      }),
    isUniqueConstraintViolation: (err) =>
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002",
  });

  return { attempt, best: await bestScore(userId, articleId, attempt.scorePct) };
}

/** Best scorePct across all attempts for this user+article (>= fallback). */
async function bestScore(
  userId: string,
  articleId: string,
  fallback: number,
): Promise<number> {
  const agg = await prisma.quizAttempt.aggregate({
    where: { userId, articleId },
    _max: { scorePct: true },
  });
  return agg._max.scorePct ?? fallback;
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
