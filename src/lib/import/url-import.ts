import type { Session } from "next-auth";
import { ApiError } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ArticleStatus, Prisma } from "@prisma/client";
import { assertSafeUrl } from "@/lib/scraper/ssrf";
import { scrapeUrl } from "@/lib/scraper";
import type { ScrapedArticle } from "@/lib/scraper/types";
import { heuristicDifficulty } from "@/lib/difficulty";
import {
  findOwnedArticleBySourceUrl,
  privateImportedArticleCreateFields,
} from "@/lib/article-library/policy";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import { recordSecurityEvent, SECURITY_EVENT_TYPES, type SecurityEventInput } from "@/lib/security/events";
import { clientIp } from "@/lib/security/client-ip";
import { recordEvent, ANALYTICS_EVENT_TYPES, type AnalyticsEventInput } from "@/lib/analytics/events";
import { assertWithinDailyQuota } from "@/lib/import/quota";

/**
 * Minimal Prisma client shape needed for the import transaction.
 *
 * Using a narrow interface avoids the union-overload issue with PrismaClient's
 * full `$transaction` signature and keeps the dep type easy to stub in tests.
 */
type ImportDb = {
  $transaction<R>(fn: (tx: any) => Promise<R>): Promise<R>;
};

/**
 * Injectable dependencies for URL import orchestration (REF-086).
 *
 * All fields are optional in `UrlImportInput.deps` — defaults resolve to the
 * real implementations so production callers never pass this object.
 *
 * Inject narrow stubs in tests instead of broad `mock.module` replacements:
 * each field covers exactly one external boundary (DB, network, side effect).
 */
export type UrlImportDeps = {
  /** SSRF guard — throws on unsafe or disallowed URL. */
  assertSafeUrl: (url: string) => Promise<void>;
  /** Resolve an owned article by source URL for de-duplication. */
  findOwnedArticleBySourceUrl: (url: string, userId: string) => Promise<{ id: string } | null>;
  /** Article scraper — returns null when extraction fails. */
  scrape: (url: string) => Promise<ScrapedArticle | null>;
  /** Daily quota guard — throws ApiError(429) when the user is at their limit. */
  assertWithinDailyQuota: (userId: string) => Promise<void>;
  /** Prisma client used for the create-with-difficulty transaction. */
  db: ImportDb;
  /** Audit log writer — called inside the transaction. */
  recordAuditFromRequest: typeof recordAuditFromRequest;
  /** Security event emitter — called on SSRF rejection. */
  recordSecurityEvent: (evt: SecurityEventInput) => void;
  /** Analytics event emitter — called after a successful import. */
  recordEvent: (input: AnalyticsEventInput) => Promise<void>;
};

export type UrlImportInput = {
  rawUrl: string;
  userId: string;
  req: Request;
  session: Session;
  requestId: string;
  /** Optional dep overrides for testing. Production callers omit this. */
  deps?: Partial<UrlImportDeps>;
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
 *
 * Pass `deps` in `input` to override external I/O callables in tests.
 * Production callers omit `deps`; defaults resolve to the real implementations.
 */
export async function importArticleFromUrl(
  input: UrlImportInput,
): Promise<ImportResult> {
  const { rawUrl, userId, req, session, requestId } = input;

  // Resolve deps — production callers omit `input.deps`; defaults are real impls.
  const assertSafe   = input.deps?.assertSafeUrl              ?? assertSafeUrl;
  const findOwned    = input.deps?.findOwnedArticleBySourceUrl ?? findOwnedArticleBySourceUrl;
  const scrape       = input.deps?.scrape                      ?? scrapeUrl;
  const checkQuota   = input.deps?.assertWithinDailyQuota      ?? assertWithinDailyQuota;
  // Cast needed: PrismaClient.$transaction has multiple overloads; we use
  // only the function-callback form. The cast is safe because the real
  // PrismaClient implements this overload.
  const db: ImportDb    = (input.deps?.db                          ?? prisma) as ImportDb;
  const recordAudit  = input.deps?.recordAuditFromRequest      ?? recordAuditFromRequest;
  const recordSec    = input.deps?.recordSecurityEvent         ?? recordSecurityEvent;
  const recordEvt    = input.deps?.recordEvent                 ?? recordEvent;

  // SSRF guard — must not be bypassed.
  try {
    await assertSafe(rawUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordSec({
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
  const existingByRawUrl = await findOwned(rawUrl, userId);
  if (existingByRawUrl) {
    return { status: 200, id: existingByRawUrl.id, duplicate: true };
  }

  let scraped;
  try {
    scraped = await scrape(rawUrl);
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
    const existingByCanonical = await findOwned(scraped.sourceUrl, userId);
    if (existingByCanonical) {
      return { status: 200, id: existingByCanonical.id, duplicate: true };
    }
  }

  // Not a duplicate — now enforce the daily quota.
  await checkQuota(userId);

  let article;
  try {
    article = await db.$transaction(async (tx) => {
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
      await recordAudit(
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
    const existing = await resolveDuplicateOnConflict(err, scraped.sourceUrl, userId, findOwned);
    if (existing) {
      return { status: 200, id: existing.id, duplicate: true };
    }
    throw err;
  }

  // Product analytics: metadata only — never record article text.
  await recordEvt({
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
  findOwned: (url: string, userId: string) => Promise<{ id: string } | null>,
): Promise<{ id: string } | null> {
  const isP2002 =
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
  if (!isP2002 || !sourceUrl) return null;
  return findOwned(sourceUrl, userId);
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
