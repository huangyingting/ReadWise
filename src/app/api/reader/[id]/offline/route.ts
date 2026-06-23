import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { readingMinutesFor } from "@/lib/articles";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";
import { sanitizeArticleHtml } from "@/lib/sanitize";

/**
 * GET /api/reader/[id]/offline
 *
 * Returns a self-contained, user-agnostic article payload for offline reading.
 * Auth-gated (requires a valid session) but the payload contains NO user-specific
 * data (no progress, no saved-word state, no session tokens). The content is the
 * same for every authenticated user — safe to store in client-side IndexedDB.
 */
export const GET = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const article = await getReadableArticleById(params.id, articleAccessContext(session.user));
    if (!article) {
      throw new ApiError(404, "Article not found");
    }

    const sanitizedHtml = sanitizeArticleHtml(article.content);

    return NextResponse.json({
      id: article.id,
      title: article.title,
      sanitizedHtml,
      author: article.author ?? null,
      source: article.source ?? null,
      sourceUrl: article.sourceUrl ?? null,
      heroImage: article.heroImage ?? null,
      difficulty: article.difficulty ?? null,
      readingMinutes: readingMinutesFor(article) ?? null,
      publishedAt: article.publishedAt
        ? new Date(article.publishedAt).toISOString()
        : null,
    });
  },
);
