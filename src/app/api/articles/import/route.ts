export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { createHandler, ApiError } from "@/lib/api-handler";
import {
  object,
  nonEmptyString,
  optional,
  string,
  queryInt,
} from "@/lib/validation";
import { assertSafeUrl } from "@/lib/scraper/ssrf";
import { scrapeUrl } from "@/lib/scraper";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import {
  countWords,
  listPersonalArticlesPage,
  toListingArticle,
  IMPORTS_PAGE_SIZE,
  IMPORTS_MAX_LIMIT,
} from "@/lib/articles";
import { getProgressSummaries } from "@/lib/progress";
import { prisma } from "@/lib/prisma";
import { ArticleStatus, Prisma } from "@prisma/client";
import { heuristicDifficulty } from "@/lib/difficulty";
import {
  findOwnedArticleBySourceUrl,
  ownedArticleWhere,
  privateImportedArticleCreateFields,
} from "@/lib/article-access";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/audit";
import { recordSecurityEvent, SECURITY_EVENT_TYPES } from "@/lib/security-events";
import { clientIp } from "@/lib/client-ip";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics";

/** Max personal imports per user per calendar day. */
const DAILY_IMPORT_LIMIT = 5;
/** Max length for pasted text body. */
const MAX_TEXT_BYTES = 200_000;
/** Minimum word count for a pasted text import (mirrors the scraper's 50-word rejection). */
const MIN_IMPORT_WORDS = 50;

const importBody = object({
  url: optional(nonEmptyString(2000)),
  title: optional(nonEmptyString(500)),
  text: optional(string({ min: 0, max: MAX_TEXT_BYTES })),
});

/** Returns the start of the current UTC day. */
function utcDayStart(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * Enforces the per-user daily import quota. Throws 429 when the user has
 * already created {@link DAILY_IMPORT_LIMIT} articles in the current UTC day.
 * Called only AFTER duplicate detection so re-importing an existing URL never
 * consumes quota.
 */
async function assertWithinDailyQuota(userId: string): Promise<void> {
  const dayStart = utcDayStart();
  const todayCount = await prisma.article.count({
    where: ownedArticleWhere(userId, { createdAt: { gte: dayStart } }),
  });
  if (todayCount >= DAILY_IMPORT_LIMIT) {
    throw new ApiError(
      429,
      `You have reached the daily import limit (${DAILY_IMPORT_LIMIT} articles per day). Try again tomorrow.`,
    );
  }
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

    // --- Branch: URL import or text paste --------------------------------
    if (body.url) {
      return handleUrlImport(body.url, userId, req, session, requestId);
    }

    if (body.text !== undefined && body.text !== null) {
      const title = body.title?.trim() || "Untitled import";
      return handleTextImport(title, body.text, userId, req, session, requestId);
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

async function handleUrlImport(
  rawUrl: string,
  userId: string,
  req: Request,
  session: Session,
  requestId: string,
): Promise<Response> {
  // SSRF guard — must not be bypassed.
  try {
    await assertSafeUrl(rawUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordSecurityEvent({
      type: SECURITY_EVENT_TYPES.importBlocked,
      severity: "high",
      route: "/api/articles/import",
      actorId: userId,
      ip: clientIp(req),
      meta: { reason: "ssrf_blocked", error: message },
    });
    throw new ApiError(422, `Invalid or unsafe URL: ${message}`);
  }

  // De-dupe BEFORE scraping/creating so re-importing never consumes quota.
  // Match the raw URL the user submitted first (cheap, avoids a scrape).
  const existingByRawUrl = await findOwnedArticleBySourceUrl(rawUrl, userId);
  if (existingByRawUrl) {
    return NextResponse.json(
      { id: existingByRawUrl.id, duplicate: true },
      { status: 200 },
    );
  }

  let scraped;
  try {
    scraped = await scrapeUrl(rawUrl);
  } catch (err) {
    throw new ApiError(
      422,
      `Scrape failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!scraped) {
    throw new ApiError(
      422,
      "Could not extract article content from that URL. The page may be behind a paywall or use an unsupported format.",
    );
  }

  // The canonical scraped sourceUrl may differ from the submitted URL (redirects,
  // canonicalisation). De-dupe again on it before creating / consuming quota.
  if (scraped.sourceUrl && scraped.sourceUrl !== rawUrl) {
    const existingByCanonical = await findOwnedArticleBySourceUrl(scraped.sourceUrl, userId);
    if (existingByCanonical) {
      return NextResponse.json(
        { id: existingByCanonical.id, duplicate: true },
        { status: 200 },
      );
    }
  }

  // Not a duplicate — now enforce the daily quota.
  await assertWithinDailyQuota(userId);

  let article;
  try {
    article = await prisma.$transaction(async (tx) => {
      const created = await tx.article.create({
        data: {
          title: scraped.title,
          author: scraped.author,
          source: scraped.source,
          sourceUrl: scraped.sourceUrl,
          heroImage: scraped.heroImage,
          excerpt: scraped.excerpt,
          content: scraped.content,
          category: scraped.category,
          wordCount: scraped.wordCount,
          readingMinutes: scraped.readingMinutes,
          status: ArticleStatus.PUBLISHED,
          publishedAt: scraped.publishedAt ?? new Date(),
          ...privateImportedArticleCreateFields(userId),
        },
        select: { id: true },
      });
      await applyHeuristicDifficulty(created.id, scraped.content, tx);
      await recordAuditFromRequest(
        {
          req,
          session,
          requestId,
          action: AUDIT_ACTIONS.articleImport,
          targetType: "article",
          targetId: created.id,
          metadata: { importType: "url" },
        },
        tx,
      );
      return created;
    });
  } catch (err) {
    // A concurrent import of the same URL won the race between the dedupe
    // pre-check and this insert. The @@unique([sourceUrl, ownerId]) constraint
    // surfaces a P2002; resolve the winner's row and return it as a duplicate
    // (no second row, no double AI spend) instead of a 500.
    const existing = await resolveDuplicateOnConflict(err, scraped.sourceUrl, userId);
    if (existing) {
      return NextResponse.json({ id: existing.id, duplicate: true }, { status: 200 });
    }
    throw err;
  }

  // Product analytics (RW-051): a successful personal import. Metadata only.
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.import,
    userId,
    articleId: article.id,
    properties: { importType: "url", category: scraped.category },
  });

  return NextResponse.json({ id: article.id }, { status: 201 });
}

/**
 * On a Prisma P2002 unique-constraint violation, re-resolves the existing
 * article that a concurrent writer created for the same (sourceUrl, ownerId).
 * Returns null for any other error (caller re-throws) or when sourceUrl is
 * absent (the unique key can't match a NULL sourceUrl).
 */
async function resolveDuplicateOnConflict(
  err: unknown,
  sourceUrl: string | null | undefined,
  userId: string,
): Promise<{ id: string } | null> {
  const isP2002 =
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
  if (!isP2002 || !sourceUrl) return null;
  return findOwnedArticleBySourceUrl(sourceUrl, userId);
}

async function handleTextImport(
  title: string,
  text: string,
  userId: string,
  req: Request,
  session: Session,
  requestId: string,
): Promise<Response> {
  if (!text.trim()) {
    throw new ApiError(400, "text must not be empty.");
  }

  await assertWithinDailyQuota(userId);

  // Wrap each paragraph block in a <p> tag, then sanitize.
  const rawHtml = text
    .split(/\n{2,}|\r\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("\n");

  const content = sanitizeArticleHtml(rawHtml);
  const wordCount = countWords(content);
  const readingMinutes = Math.max(1, Math.round(wordCount / 200));

  if (wordCount < MIN_IMPORT_WORDS) {
    throw new ApiError(400, `Article text is too short (minimum ${MIN_IMPORT_WORDS} words).`);
  }

  const article = await prisma.$transaction(async (tx) => {
    const created = await tx.article.create({
      data: {
        title,
        source: "Personal",
        content,
        wordCount,
        readingMinutes,
        status: ArticleStatus.PUBLISHED,
        publishedAt: new Date(),
        ...privateImportedArticleCreateFields(userId),
      },
      select: { id: true },
    });
    await applyHeuristicDifficulty(created.id, content, tx);
    await recordAuditFromRequest(
      {
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.articleImport,
        targetType: "article",
        targetId: created.id,
        metadata: { importType: "text" },
      },
      tx,
    );
    return created;
  });

  // Product analytics (RW-051): a successful personal text import. Metadata only.
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.import,
    userId,
    articleId: article.id,
    properties: { importType: "text" },
  });

  return NextResponse.json({ id: article.id }, { status: 201 });
}

/** Runs heuristic (no-AI) difficulty and persists it. Non-fatal. */
async function applyHeuristicDifficulty(
  articleId: string,
  content: string,
  client: Pick<Prisma.TransactionClient, "article"> = prisma,
): Promise<void> {
  try {
    const { level: difficulty, score: difficultyScore } = heuristicDifficulty(content);
    await client.article.update({
      where: { id: articleId },
      data: { difficulty, difficultyScore },
    });
  } catch {
    // Non-fatal — difficulty can be computed lazily by the reader.
  }
}
