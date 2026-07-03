import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { queryString, queryInt } from "@/lib/validation";
import { SEARCH_PAGE_SIZE, SEARCH_MAX_LIMIT } from "@/lib/search/query";
import { searchReadableArticles } from "@/lib/search/providers";
import { toListingArticle } from "@/lib/article-library/mapper";
import { buildArticleListResponse } from "@/lib/article-library/listing-response";
import { checkRateLimit } from "@/lib/security/rate-limit/index";

const SEARCH_QUERY_MAX_LENGTH = 200;

type SearchQuery = {
  q: string;
  offset: number;
  limit: number;
};

type ParsedSearchQuery =
  | { ok: true; value: SearchQuery }
  | { ok: false; error: string };

function searchQueryError(message: string): ParsedSearchQuery {
  return { ok: false, error: message };
}

function parseQuery(params: URLSearchParams): ParsedSearchQuery {
  const q = queryString(params, "q");
  if (q.length > SEARCH_QUERY_MAX_LENGTH) {
    return searchQueryError(`q must be at most ${SEARCH_QUERY_MAX_LENGTH} characters`);
  }

  return {
    ok: true,
    value: {
      q,
      offset: queryInt(params, "offset", { fallback: 0, min: 0 }),
      limit: queryInt(params, "limit", {
        fallback: SEARCH_PAGE_SIZE,
        min: 1,
        max: SEARCH_MAX_LIMIT,
      }),
    },
  };
}

async function searchResponse(query: SearchQuery, userId: string) {
  const { q, offset, limit } = query;
  const page = await searchReadableArticles(q, { offset, limit }, userId);
  const articles = page.articles.map(toListingArticle);

  return buildArticleListResponse(userId, articles, {
    offset,
    hasMore: articles.length > 0 && page.hasMore,
  });
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
  await checkRateLimit(session.user.id, "lookup");

  return NextResponse.json(await searchResponse(query, session.user.id));
});
