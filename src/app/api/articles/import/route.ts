export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import {
  object,
  nonEmptyString,
  optional,
  string,
  queryInt,
} from "@/lib/validation";
import {
  listPersonalArticlesPage,
  toListingArticle,
  IMPORTS_PAGE_SIZE,
  IMPORTS_MAX_LIMIT,
} from "@/lib/articles";
import { getProgressSummaries } from "@/lib/progress";
import { MAX_TEXT_BYTES, importArticleFromUrl, importArticleFromText } from "@/lib/import";

const importBody = object({
  url: optional(nonEmptyString(2000)),
  title: optional(nonEmptyString(500)),
  text: optional(string({ min: 0, max: MAX_TEXT_BYTES })),
});

/**
 * POST /api/articles/import
 *
 * Authenticated: creates a PERSONAL article for the calling user.
 * Accepts either `{url}` (scrape + extract) or `{title, text}` (paste text).
 * The resulting article is private: only visible to its owner in the reader.
 * Rate-limited to 5 submissions per UTC day per user. Re-importing a URL that
 * the user already imported returns the existing article (200, `duplicate:true`)
 * without creating a new row or consuming quota.
 */
export const POST = createHandler(
  { body: importBody },
  async ({ req, body, session, requestId }) => {
    const userId = session.user.id;

    if (body.url) {
      const result = await importArticleFromUrl({ rawUrl: body.url, userId, req, session, requestId });
      if (result.status === 200) {
        return NextResponse.json({ id: result.id, duplicate: true }, { status: 200 });
      }
      return NextResponse.json({ id: result.id }, { status: 201 });
    }

    if (body.text !== undefined && body.text !== null) {
      const title = body.title?.trim() || "Untitled import";
      const result = await importArticleFromText({ title, text: body.text, userId, req, session, requestId });
      return NextResponse.json({ id: result.id }, { status: 201 });
    }

    throw new ApiError(400, "Provide either `url` or `text` in the request body.");
  },
);

// ---------------------------------------------------------------------------

type ImportsListQuery = { offset: number; limit: number };

function parseListQuery(params: URLSearchParams) {
  const value: ImportsListQuery = {
    offset: queryInt(params, "offset", { fallback: 0, min: 0 }),
    limit: queryInt(params, "limit", {
      fallback: IMPORTS_PAGE_SIZE,
      min: 1,
      max: IMPORTS_MAX_LIMIT,
    }),
  };
  return { ok: true as const, value };
}

/**
 * GET /api/articles/import — paginated list of the caller's own personal
 * imports (newest first) for the `/import` "Load more" affordance. Returns
 * `{ articles, progress, hasMore, offset }` — same shape as GET /api/articles.
 * Session-gated (401 when unauthenticated).
 */
export const GET = createHandler(
  { query: parseListQuery },
  async ({ query, session }) => {
    const { offset, limit } = query;
    const page = await listPersonalArticlesPage(session.user.id, { offset, limit });
    const progress = await getProgressSummaries(
      session.user.id,
      page.articles.map((a) => a.id),
    );
    return NextResponse.json({
      articles: page.articles.map(toListingArticle),
      progress,
      hasMore: page.hasMore,
      offset: offset + page.articles.length,
    });
  },
);
