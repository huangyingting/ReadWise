export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { listPersonalArticlesPage } from "@/lib/article-library/listings";
import { toListingArticle } from "@/lib/article-library/mapper";
import { buildArticleListResponse } from "@/lib/article-library/listing-response";
import { importArticleFromUrl, importArticleFromText } from "@/lib/import";
import { importBody, parseListQuery } from "@/lib/import/schemas";

const UNTITLED_IMPORT_TITLE = "Untitled import";

function importTitle(title: string | undefined): string {
  return title?.trim() || UNTITLED_IMPORT_TITLE;
}

async function importUrl(
  body: { url: string },
  context: Omit<Parameters<typeof importArticleFromUrl>[0], "rawUrl">,
) {
  const result = await importArticleFromUrl({ ...context, rawUrl: body.url });
  if (result.status === 200) {
    return NextResponse.json({ id: result.id, duplicate: true }, { status: 200 });
  }
  return NextResponse.json({ id: result.id }, { status: 201 });
}

async function importText(
  body: { title?: string; text: string },
  context: Omit<Parameters<typeof importArticleFromText>[0], "title" | "text">,
) {
  const result = await importArticleFromText({
    ...context,
    title: importTitle(body.title),
    text: body.text,
  });
  return NextResponse.json({ id: result.id }, { status: 201 });
}

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
      return importUrl({ url: body.url }, { userId, req, session, requestId });
    }

    if (body.text !== undefined && body.text !== null) {
      return importText(
        { title: body.title, text: body.text },
        { userId, req, session, requestId },
      );
    }

    throw new ApiError(400, "Provide either `url` or `text` in the request body.");
  },
);

// ---------------------------------------------------------------------------

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
    return NextResponse.json(
      await buildArticleListResponse(session.user.id, page.articles.map(toListingArticle), {
        offset,
        hasMore: page.hasMore,
      })
    );
  },
);
