import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { queryInt } from "@/lib/validation";
import { FEED_PAGE_SIZE, FEED_MAX_LIMIT, getPersonalizedFeed } from "@/lib/feed";
import { getProgressSummaries } from "@/lib/progress";

type FeedQuery = {
  offset: number;
  limit: number;
};

function parseQuery(params: URLSearchParams) {
  const value: FeedQuery = {
    offset: queryInt(params, "offset", { fallback: 0, min: 0 }),
    limit: queryInt(params, "limit", {
      fallback: FEED_PAGE_SIZE,
      min: 1,
      max: FEED_MAX_LIMIT,
    }),
  };
  return { ok: true as const, value };
}

/**
 * Personalized "For You" feed endpoint — M15.
 *
 * Query params:
 *   - `offset` : articles to skip (incremental loading; default 0)
 *   - `limit`  : page size (default {@link FEED_PAGE_SIZE}, max {@link FEED_MAX_LIMIT})
 *
 * Response: `{ articles, progress, hasMore, offset, reasons }`
 *   - `articles`  : ListingArticle[] — same shape as /api/articles; render with ArticleCardView
 *   - `progress`  : per-article progress map keyed by articleId
 *   - `hasMore`   : boolean for incremental loading
 *   - `offset`    : updated offset to use for the next page
 *   - `reasons`   : human-readable personalisation reason per articleId
 *
 * This endpoint is session-gated (401 for unauthenticated requests) and
 * intentionally NOT cached — results are user-scoped and change with reading
 * history. Do not wrap with {@link createCachedListing}.
 */
export const GET = createHandler({ query: parseQuery }, async ({ query, session }) => {
  const { offset, limit } = query;
  const userId = session.user.id;

  const feed = await getPersonalizedFeed(userId, { offset, limit });

  const progress = await getProgressSummaries(
    userId,
    feed.articles.map((a) => a.id),
  );

  return NextResponse.json({
    articles: feed.articles,
    progress,
    hasMore: feed.hasMore,
    offset: offset + feed.articles.length,
    reasons: feed.reasons,
  });
});
