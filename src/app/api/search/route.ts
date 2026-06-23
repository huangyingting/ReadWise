import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { queryString, queryInt } from "@/lib/validation";
import {
  SEARCH_PAGE_SIZE,
  SEARCH_MAX_LIMIT,
  searchPublishedArticles,
  toListingArticle,
} from "@/lib/articles";
import { getProgressSummaries } from "@/lib/progress";
import { checkRateLimit } from "@/lib/rate-limit";

const SEARCH_QUERY_MAX_LENGTH = 200;

type SearchQuery = {
  q: string;
  offset: number;
  limit: number;
};

function parseQuery(params: URLSearchParams) {
  const q = queryString(params, "q");
  if (q.length > SEARCH_QUERY_MAX_LENGTH) {
    return {
      ok: false as const,
      error: `q must be at most ${SEARCH_QUERY_MAX_LENGTH} characters`,
    };
  }
  const value: SearchQuery = {
    q,
    offset: queryInt(params, "offset", { fallback: 0, min: 0 }),
    limit: queryInt(params, "limit", {
      fallback: SEARCH_PAGE_SIZE,
      min: 1,
      max: SEARCH_MAX_LIMIT,
    }),
  };
  return { ok: true as const, value };
}

/**
 * User-facing global article search. Query params:
 *   - `q`      : search term matched by the configured article-search provider.
 *                Blank / missing → empty results (200), not an error.
 *   - `offset` : number of items to skip (incremental loading, default 0).
 *   - `limit`  : page size (default {@link SEARCH_PAGE_SIZE}, max {@link SEARCH_MAX_LIMIT}).
 * Returns `{ articles, progress, hasMore, offset }` — same shape as GET /api/articles.
 * Session-gated (401 when unauthenticated). Results are NOT cached because they
 * are query-dependent, visibility-scoped, and merged with per-user progress data.
 */
export const GET = createHandler({ query: parseQuery }, async ({ query, session }) => {
  checkRateLimit(session.user.id, "lookup");

  const { q, offset, limit } = query;

  const page = await searchPublishedArticles(q, { offset, limit }, session.user.id);

  const progress = await getProgressSummaries(
    session.user.id,
    page.articles.map((a) => a.id),
  );
  const nextOffset = offset + page.articles.length;

  return NextResponse.json({
    articles: page.articles.map(toListingArticle),
    progress,
    hasMore: page.articles.length > 0 && page.hasMore,
    offset: nextOffset,
  });
});
