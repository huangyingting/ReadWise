/**
 * Annotation read models — server-side queries.
 *
 * All queries are scoped to the authenticated user (userId in WHERE — no IDOR).
 * Article existence / readability checks remain the caller's responsibility
 * (enforced by the reader route-guard before these functions are called).
 */
import { prisma } from "@/lib/prisma";
import type { HighlightRow, HighlightWithArticle } from "./anchor";

// Shared Prisma projection — matches HighlightRow exactly.
export const highlightSelect = {
  id: true,
  quote: true,
  startOffset: true,
  endOffset: true,
  prefix: true,
  suffix: true,
  note: true,
  color: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * List all highlights for a given user + article, ordered by startOffset.
 * Returns an empty array when the article exists but has no highlights.
 * Does NOT validate article existence — callers must check that separately.
 */
export async function listHighlights(
  userId: string,
  articleId: string,
): Promise<HighlightRow[]> {
  return prisma.highlight.findMany({
    where: { userId, articleId },
    select: highlightSelect,
    orderBy: { startOffset: "asc" },
  });
}

/**
 * Returns ALL highlights across ALL articles for the given user, newest first
 * within each article. Includes the article id + title for display.
 * Every row is scoped to `userId` — no IDOR possible.
 */
export async function listAllUserHighlights(
  userId: string,
): Promise<HighlightWithArticle[]> {
  return prisma.highlight.findMany({
    where: { userId },
    select: {
      ...highlightSelect,
      article: { select: { id: true, title: true } },
    },
    orderBy: [{ article: { title: "asc" } }, { createdAt: "desc" }],
    take: 1000,
  });
}

/**
 * Batch count of highlights per article for the given user.
 * Useful for dashboards / listing badges. Returns a map of articleId → count
 * (articles with 0 highlights are omitted).
 */
export async function getHighlightCounts(
  userId: string,
  articleIds: string[],
): Promise<Record<string, number>> {
  if (articleIds.length === 0) return {};

  const rows = await prisma.highlight.groupBy({
    by: ["articleId"],
    where: { userId, articleId: { in: articleIds } },
    _count: { id: true },
  });

  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.articleId] = row._count.id;
  }
  return map;
}
