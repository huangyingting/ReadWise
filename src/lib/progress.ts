import { prisma } from "@/lib/prisma";
import type { ReadingProgress } from "@prisma/client";
import { toListingArticle, type ListingArticle } from "@/lib/articles";
import { recordReadingActivity } from "@/lib/activity";
import { createLogger } from "@/lib/logger";

const log = createLogger("progress");

/** Scroll percent at/above which an article is considered finished. */
export const COMPLETION_THRESHOLD = 95;

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function getProgress(
  userId: string,
  articleId: string,
): Promise<ReadingProgress | null> {
  return prisma.readingProgress.findUnique({
    where: { userId_articleId: { userId, articleId } },
  });
}

/**
 * Batch fetch progress for a set of articles, keyed by articleId. Used by
 * listings so each card can reflect saved progress in a single query.
 */
export async function getProgressMap(
  userId: string,
  articleIds: string[],
): Promise<Map<string, ReadingProgress>> {
  const map = new Map<string, ReadingProgress>();
  if (articleIds.length === 0) {
    return map;
  }
  const rows = await prisma.readingProgress.findMany({
    where: { userId, articleId: { in: articleIds } },
  });
  for (const row of rows) {
    map.set(row.articleId, row);
  }
  return map;
}

/** Serializable progress summary safe to send to the client. */
export type ProgressSummary = {
  percent: number;
  completed: boolean;
};

/**
 * Batch fetch progress for a set of articles as plain, serializable summaries
 * keyed by articleId. Backs the listing batch endpoint so a single query
 * returns progress for many articles (no N+1).
 */
export async function getProgressSummaries(
  userId: string,
  articleIds: string[],
): Promise<Record<string, ProgressSummary>> {
  const map = await getProgressMap(userId, articleIds);
  const summaries: Record<string, ProgressSummary> = {};
  for (const [articleId, row] of map) {
    summaries[articleId] = { percent: row.percent, completed: row.completed };
  }
  return summaries;
}

export type InProgressEntry = {
  article: ListingArticle;
  progress: ProgressSummary;
};

/**
 * Returns articles the user has started but not yet completed, ordered by most
 * recently updated. Used by the continue-reading rail on the dashboard.
 * Only published articles are included.
 */
export async function listInProgressArticles(
  userId: string,
  limit = 10,
): Promise<InProgressEntry[]> {
  const rows = await prisma.readingProgress.findMany({
    where: { userId, percent: { gt: 0 }, completed: false, article: { status: "published" } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: { article: true },
  });
  return rows.map((row) => ({
    article: toListingArticle(row.article),
    progress: { percent: row.percent, completed: row.completed },
  }));
}

/**
 * Persist progress for a user+article. Progress is forward-only: the stored
 * percent never decreases and completion is sticky. Reaching the completion
 * threshold marks the article completed.
 */
export async function saveProgress(
  userId: string,
  articleId: string,
  rawPercent: number,
): Promise<ReadingProgress> {
  const incoming = clampPercent(rawPercent);
  const existing = await getProgress(userId, articleId);

  const percent = existing ? Math.max(existing.percent, incoming) : incoming;
  const completed =
    (existing?.completed ?? false) || percent >= COMPLETION_THRESHOLD;
  const completedAt =
    existing?.completedAt ?? (completed ? new Date() : null);

  let result: ReadingProgress;
  if (existing) {
    result = await prisma.readingProgress.update({
      where: { id: existing.id },
      data: { percent, completed, completedAt },
    });
  } else {
    result = await prisma.readingProgress.create({
      data: { userId, articleId, percent, completed, completedAt },
    });
  }

  // Side-effect: record daily activity (errors are logged but never
  // affect the caller's return value or forward-only semantics).
  try {
    await recordReadingActivity(userId, articleId);
  } catch (err) {
    log.error("activity recording failed", { userId, articleId, err });
  }

  return result;
}
