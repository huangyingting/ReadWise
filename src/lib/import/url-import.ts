import type { Session } from "next-auth";
import { ApiError } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ArticleStatus, Prisma } from "@prisma/client";
import { assertSafeUrl } from "@/lib/scraper/ssrf";
import { scrapeUrl } from "@/lib/scraper";
import { heuristicDifficulty } from "@/lib/difficulty";
import {
  findOwnedArticleBySourceUrl,
  privateImportedArticleCreateFields,
} from "@/lib/article-access";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/audit";
import { recordSecurityEvent, SECURITY_EVENT_TYPES } from "@/lib/security-events";
import { clientIp } from "@/lib/client-ip";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import { assertWithinDailyQuota } from "@/lib/import/quota";

export type UrlImportInput = {
  rawUrl: string;
  userId: string;
  req: Request;
  session: Session;
  requestId: string;
};

export type ImportResult =
  | { status: 201; id: string }
  | { status: 200; id: string; duplicate: true };

/**
 * Imports an article from a URL for the given user.
 *
 * Flow:
 *  1. SSRF guard (reject unsafe / non-http URLs and record a security event).
 *  2. De-dupe on raw URL before scraping (avoids network round-trip + quota use).
 *  3. Scrape the URL.
 *  4. De-dupe on the canonical (scraped) sourceUrl.
 *  5. Enforce daily quota.
 *  6. Create article + apply heuristic difficulty + record audit log (in a transaction).
 *  7. On P2002 concurrent-import conflict, resolve and return the winner as duplicate.
 *  8. Record analytics event (metadata only).
 */
export async function importArticleFromUrl(
  input: UrlImportInput,
): Promise<ImportResult> {
  const { rawUrl, userId, req, session, requestId } = input;

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
  const existingByRawUrl = await findOwnedArticleBySourceUrl(rawUrl, userId);
  if (existingByRawUrl) {
    return { status: 200, id: existingByRawUrl.id, duplicate: true };
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

  // De-dupe on canonical sourceUrl (redirects / canonicalisation may differ).
  if (scraped.sourceUrl && scraped.sourceUrl !== rawUrl) {
    const existingByCanonical = await findOwnedArticleBySourceUrl(scraped.sourceUrl, userId);
    if (existingByCanonical) {
      return { status: 200, id: existingByCanonical.id, duplicate: true };
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
    // surfaces a P2002; resolve the winner's row and return it as a duplicate.
    const existing = await resolveDuplicateOnConflict(err, scraped.sourceUrl, userId);
    if (existing) {
      return { status: 200, id: existing.id, duplicate: true };
    }
    throw err;
  }

  // Product analytics: metadata only — never record article text.
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.import,
    userId,
    articleId: article.id,
    properties: { importType: "url", category: scraped.category },
  });

  return { status: 201, id: article.id };
}

/**
 * On a Prisma P2002 unique-constraint violation, re-resolves the existing
 * article for the same (sourceUrl, ownerId). Returns null for any other error
 * or when sourceUrl is absent (NULL can't match the unique key).
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
