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
 * Hard cap for the cross-article highlight list. One extra row is fetched to
 * detect overflow; callers receive `hasMore: true` when the cap is reached so
 * they can surface a "load more" affordance rather than silently truncating.
 *
 * 1 000 highlights is well above the P99 per-user count; a future issue (#622)
 * will add cursor-based pagination when usage data justifies it.
 */
export const HIGHLIGHTS_ALL_HARD_CAP = 1_000;

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

export type HighlightPage = {
  highlights: HighlightWithArticle[];
  /** True when the result was capped at {@link HIGHLIGHTS_ALL_HARD_CAP}. */
  hasMore: boolean;
};

/**
 * Returns up to {@link HIGHLIGHTS_ALL_HARD_CAP} highlights across ALL articles
 * for the given user, newest first within each article. Includes the article
 * id + title for display. Returns `hasMore: true` when the cap is reached so
 * callers can inform the user rather than silently dropping results.
 *
 * Every row is scoped to `userId` — no IDOR possible.
 */
export async function listAllUserHighlights(
  userId: string,
): Promise<HighlightWithArticle[]> {
  const rows = await prisma.highlight.findMany({
    where: { userId },
    select: {
      ...highlightSelect,
      article: { select: { id: true, title: true } },
    },
    orderBy: [{ article: { title: "asc" } }, { createdAt: "desc" }],
    // Fetch one extra to detect whether more rows exist beyond the hard cap.
    take: HIGHLIGHTS_ALL_HARD_CAP + 1,
  });
  // Trim to the cap; callers can check `length === HIGHLIGHTS_ALL_HARD_CAP` or
  // use the HighlightPage overload below when they need the `hasMore` signal.
  return rows.length > HIGHLIGHTS_ALL_HARD_CAP
    ? rows.slice(0, HIGHLIGHTS_ALL_HARD_CAP)
    : rows;
}

/**
 * Like {@link listAllUserHighlights} but surfaces the `hasMore` flag so UIs
 * can render a "showing first 1 000 highlights" notice when the cap is hit.
 */
export async function listAllUserHighlightsPage(
  userId: string,
): Promise<HighlightPage> {
  const rows = await prisma.highlight.findMany({
    where: { userId },
    select: {
      ...highlightSelect,
      article: { select: { id: true, title: true } },
    },
    orderBy: [{ article: { title: "asc" } }, { createdAt: "desc" }],
    take: HIGHLIGHTS_ALL_HARD_CAP + 1,
  });
  const hasMore = rows.length > HIGHLIGHTS_ALL_HARD_CAP;
  return {
    highlights: hasMore ? rows.slice(0, HIGHLIGHTS_ALL_HARD_CAP) : rows,
    hasMore,
  };
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
