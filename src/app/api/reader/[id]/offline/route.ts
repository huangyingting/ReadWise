import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { readingMinutesFor } from "@/lib/articles";
import { requireReadableArticle } from "@/lib/reader/route-guard";
import { sanitizeArticleHtml } from "@/lib/content-pipeline";
import { contentHash, makeArticleVersion } from "@/lib/cache-version";

/**
 * GET /api/reader/[id]/offline
 *
 * Returns a self-contained, user-agnostic article payload for offline reading.
 * Auth-gated (requires a valid session) but the payload contains NO user-specific
 * data (no progress, no saved-word state, no session tokens). The content is the
 * same for every authenticated user — safe to store in client-side IndexedDB.
 *
 * Cache versioning (RW-044): every payload carries a `version` (and `contentHash`)
 * so the client can detect when its cached copy is stale and refresh it. Pass
 * `?meta=1` for a cheap version-only response (no content) used for those checks.
 */
export const GET = createHandler(
  {
    params: idParams,
    query: (params) => ({ ok: true, value: { meta: params.get("meta") === "1" } }),
  },
  async ({ params, query, session }) => {
    const { article } = await requireReadableArticle(params.id, session.user);

    const sanitizedHtml = sanitizeArticleHtml(article.content);
    const hash = contentHash(sanitizedHtml);
    const version = makeArticleVersion({ contentHash: hash, updatedAt: article.updatedAt });

    // Cheap metadata-only response for stale-cache checks.
    if (query.meta) {
      return NextResponse.json({
        id: article.id,
        version,
        contentHash: hash,
        updatedAt: new Date(article.updatedAt).toISOString(),
      });
    }

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
      version,
      contentHash: hash,
    });
  },
);
