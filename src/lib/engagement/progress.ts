/**
 * Reading-progress service for the engagement subsystem.
 *
 * Forward-only, race-safe progress writes: the stored percent never decreases
 * and completion is sticky. Daily activity recording is called as an explicit
 * side-effect so the dependency is visible and testable.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { ReadingProgress } from "@prisma/client";
import { toListingArticle, type ListingArticle } from "@/lib/articles";
import { publicListableArticleWhere } from "@/lib/article-access";
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
    where: {
      userId,
      percent: { gt: 0 },
      completed: false,
      article: publicListableArticleWhere(),
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: { article: true },
  });
  return rows.map((row) => ({
    article: toListingArticle(row.article),
    progress: { percent: row.percent, completed: row.completed },
  }));
}

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Max attempts for the race-safe progress write loop. */
const MAX_WRITE_ATTEMPTS = 3;

/**
 * Race-safe, forward-only progress write. Because two concurrent first-writes
 * (multi-tab / scroll-write + flush-on-unmount) on the `userId_articleId`
 * unique would make a naive read-then-create throw Prisma P2002, this:
 *   - creates the row when none exists, retrying on P2002 (a concurrent writer
 *     won the create — loop back to the update branch instead of throwing 500);
 *   - updates via a guarded `updateMany` (`percent <= newPercent`) so a
 *     concurrent higher write is never clobbered (forward-only preserved), and
 *     returns the freshly-read row regardless of which writer won.
 */
async function writeProgressForwardOnly(
  userId: string,
  articleId: string,
  incoming: number,
): Promise<ReadingProgress> {
  for (let attempt = 1; ; attempt++) {
    const existing = await getProgress(userId, articleId);

    if (!existing) {
      const completed = incoming >= COMPLETION_THRESHOLD;
      try {
        return await prisma.readingProgress.create({
          data: {
            userId,
            articleId,
            percent: incoming,
            completed,
            completedAt: completed ? new Date() : null,
          },
        });
      } catch (err) {
        // A concurrent writer created the row first — retry into the update branch.
        if (isUniqueConstraintError(err) && attempt < MAX_WRITE_ATTEMPTS) continue;
        throw err;
      }
    }

    const percent = Math.max(existing.percent, incoming);
    const completed = existing.completed || percent >= COMPLETION_THRESHOLD;
    const completedAt = existing.completedAt ?? (completed ? new Date() : null);

    // Forward-only guard: only apply when it would not lower the stored percent,
    // so a concurrent write that already raised percent beyond ours is preserved.
    await prisma.readingProgress.updateMany({
      where: { id: existing.id, percent: { lte: percent } },
      data: { percent, completed, completedAt },
    });

    const fresh = await getProgress(userId, articleId);
    if (fresh) return fresh;

    // The row vanished between read and re-read (extremely rare); retry.
    if (attempt < MAX_WRITE_ATTEMPTS) continue;
    throw new Error("progress row disappeared during update");
  }
}

/**
 * Persist progress for a user+article. Progress is forward-only: the stored
 * percent never decreases and completion is sticky. Reaching the completion
 * threshold marks the article completed. Race-safe under concurrent writes.
 */
export async function saveProgress(
  userId: string,
  articleId: string,
  rawPercent: number,
): Promise<ReadingProgress> {
  const incoming = clampPercent(rawPercent);
  const result = await writeProgressForwardOnly(userId, articleId, incoming);

  // Side-effect: record daily activity (errors are logged but never
  // affect the caller's return value or forward-only semantics).
  try {
    await recordReadingActivity(userId, articleId);
  } catch (err) {
    log.error("activity recording failed", {
      userId,
      articleId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}
