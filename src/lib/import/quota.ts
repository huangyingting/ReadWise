import { ApiError } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ownedArticleWhere } from "@/lib/article-library/policy";

/** Max personal imports per user per calendar day. */
export const DAILY_IMPORT_LIMIT = 5;

/** Returns the start of the current UTC day. */
export function utcDayStart(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * Enforces the per-user daily import quota. Throws 429 when the user has
 * already created {@link DAILY_IMPORT_LIMIT} articles in the current UTC day.
 * Must be called AFTER duplicate detection so re-importing an existing URL
 * never consumes quota.
 */
export async function assertWithinDailyQuota(userId: string): Promise<void> {
  const dayStart = utcDayStart();
  const todayCount = await prisma.article.count({
    where: ownedArticleWhere(userId, { createdAt: { gte: dayStart } }),
  });
  if (todayCount >= DAILY_IMPORT_LIMIT) {
    throw new ApiError(
      429,
      `You have reached the daily import limit (${DAILY_IMPORT_LIMIT} articles per day). Try again tomorrow.`,
    );
  }
}
