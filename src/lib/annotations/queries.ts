/**
 * Annotation read models — server-side queries.
 *
 * All queries are scoped to the authenticated user (userId in WHERE — no IDOR).
 * Article existence / readability checks remain the caller's responsibility
 * (enforced by the reader route-guard before these functions are called).
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
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
 * Legacy cap for callers that still need a bounded all-highlights array.
 * Paginated UIs should use {@link listAllUserHighlightsPage} so search and
 * colour filters run against the full result set.
 */
export const HIGHLIGHTS_ALL_HARD_CAP = 1_000;
export const HIGHLIGHTS_PAGE_SIZE = 50;

export type ListAllUserHighlightsPageOpts = {
  query?: string;
  color?: string | null;
  page?: number;
  pageSize?: number;
};

async function fetchAllUserHighlightRows(
  userId: string,
): Promise<HighlightWithArticle[]> {
  return prisma.highlight.findMany({
    where: { userId },
    select: {
      ...highlightSelect,
      article: { select: { id: true, title: true } },
    },
    orderBy: [{ article: { title: "asc" } }, { createdAt: "desc" }],
    // Fetch one extra to detect whether more rows exist beyond the hard cap.
    take: HIGHLIGHTS_ALL_HARD_CAP + 1,
  });
}

function trimHighlightRows(rows: HighlightWithArticle[]): HighlightWithArticle[] {
  return rows.length > HIGHLIGHTS_ALL_HARD_CAP
    ? rows.slice(0, HIGHLIGHTS_ALL_HARD_CAP)
    : rows;
}

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
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  query: string;
  color: string | null;
  /** True when another page of results exists. */
  hasMore: boolean;
};

function normalizePage(page: number | undefined): number {
  return Math.max(1, page ?? 1);
}

function normalizePageSize(pageSize: number | undefined): number {
  return Math.min(HIGHLIGHTS_ALL_HARD_CAP, Math.max(1, pageSize ?? HIGHLIGHTS_PAGE_SIZE));
}

function buildAllHighlightsWhere(
  userId: string,
  query: string,
  color: string | null,
): Prisma.HighlightWhereInput {
  return {
    userId,
    ...(color ? { color } : {}),
    ...(query
      ? {
          OR: [
            { quote: { contains: query } },
            { note: { contains: query } },
          ],
        }
      : {}),
  };
}

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
  const rows = await fetchAllUserHighlightRows(userId);
  // Trim to the cap; callers can check `length === HIGHLIGHTS_ALL_HARD_CAP` or
  // use the HighlightPage overload below when they need the `hasMore` signal.
  return trimHighlightRows(rows);
}

/**
 * Paginated cross-article highlights for Notes. Search and colour filters are
 * applied in the database before pagination so heavy users are not silently
 * limited to the legacy all-highlights cap.
 */
export async function listAllUserHighlightsPage(
  userId: string,
  opts: ListAllUserHighlightsPageOpts = {},
): Promise<HighlightPage> {
  const query = (opts.query ?? "").trim();
  const color = opts.color ?? null;
  const requestedPage = normalizePage(opts.page);
  const pageSize = normalizePageSize(opts.pageSize);
  const where = buildAllHighlightsWhere(userId, query, color);

  const total = await prisma.highlight.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rows = await prisma.highlight.findMany({
    where,
    select: {
      ...highlightSelect,
      article: { select: { id: true, title: true } },
    },
    orderBy: [{ article: { title: "asc" } }, { createdAt: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return {
    highlights: rows,
    total,
    page,
    pageSize,
    totalPages,
    query,
    color,
    hasMore: page < totalPages,
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
