/**
 * Shared article-list response builder (BE-9).
 *
 * All four article-listing routes (/api/articles, /api/feed, /api/search,
 * /api/articles/import) return the same envelope shape. This helper fetches
 * per-article progress and assembles the response so each route only needs to
 * supply the already-typed ListingArticle slice and pagination state.
 */
import { getProgressSummaries } from "@/lib/engagement";
import type { ProgressSummary } from "@/lib/engagement";
import type { ListingArticle } from "./mapper";

export type ArticleListResponse = {
  articles: ListingArticle[];
  progress: Record<string, ProgressSummary>;
  hasMore: boolean;
  offset: number;
  reasons?: Record<string, string>;
};

/**
 * Fetches progress data for `articles` (scoped to `userId`) and returns the
 * standard `{ articles, progress, hasMore, offset, reasons? }` response shape
 * used by all article-listing routes. Pass `reasons` only when the caller has
 * personalisation reason strings (e.g. the feed endpoint).
 */
export async function buildArticleListResponse(
  userId: string,
  articles: ListingArticle[],
  opts: { offset: number; hasMore: boolean; reasons?: Record<string, string> },
): Promise<ArticleListResponse> {
  const progress = await getProgressSummaries(
    userId,
    articles.map((a) => a.id),
  );
  const response: ArticleListResponse = {
    articles,
    progress,
    hasMore: opts.hasMore,
    offset: opts.offset + articles.length,
  };
  if (opts.reasons !== undefined) {
    response.reasons = opts.reasons;
  }
  return response;
}
