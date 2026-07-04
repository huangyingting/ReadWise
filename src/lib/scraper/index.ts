/**
 * Public barrel for the scraper subsystem.
 *
 * Persistence (saveDraftArticle, scrapeAndSave, scrapeUrl) lives here.
 * Discovery lives in `@/lib/scraper/discovery`.
 * Admin scrape trigger orchestration lives in `@/lib/scraper/admin-trigger`.
 * Content-source governance lives in `@/lib/scraper/sources`.
 */
import { prisma } from "@/lib/prisma";
import { ArticleStatus, Prisma } from "@prisma/client";
import type { ScrapedArticle } from "@/lib/scraper/types";
import { extractArticle } from "@/lib/scraper/extract";
import { fetchHtml } from "@/lib/scraper/fetch";
import { isScraperFeatureEnabled } from "@/lib/runtime-config/feature-flags";
import { checkContentQuality, isRecoverableQualityReject } from "@/lib/scraper/quality";
import { PUBLIC_ARTICLE_CREATE_FIELDS, findPublicLibraryArticleBySourceUrl } from "@/lib/article-library";
import { recordAuditFromRequest, type AuditRequestInput } from "@/lib/security/audit";

export type SaveOutcome =
  | { status: "saved"; id: string; article: ScrapedArticle }
  | { status: "skipped"; reason: string; sourceUrl: string }
  | { status: "failed"; reason: string; sourceUrl: string };

const DUPLICATE_SOURCE_URL_REASON = "duplicate sourceUrl";

/** Fetches and parses a single article URL. Returns null when extraction fails or scraper is disabled. */
export async function scrapeUrl(url: string): Promise<ScrapedArticle | null> {
  if (!isScraperFeatureEnabled()) return null;
  const html = await fetchHtml(url);
  return extractArticle(html, url);
}

/**
 * Persists a scraped article as a `draft`, de-duplicated by `sourceUrl` (for
 * library scrapes `ownerId` is null). Never throws on a duplicate — returns a
 * `skipped` outcome instead. A concurrent writer can win the race between the
 * pre-check and the insert; the `@@unique([sourceUrl, ownerId])` constraint
 * then surfaces a Prisma P2002, which is caught and reported as `skipped`
 * (re-resolving the winner's id) rather than bubbling up as a 500.
 */
export async function saveDraftArticle(
  article: ScrapedArticle,
  audit?: (created: { id: string }) => AuditRequestInput,
): Promise<SaveOutcome> {
  const existing = await findPublicLibraryArticleBySourceUrl(article.sourceUrl);
  if (existing) {
    return duplicateSourceUrlOutcome(article.sourceUrl);
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.article.create({
        data: {
          title: article.title,
          author: article.author,
          source: article.source,
          sourceUrl: article.sourceUrl,
          heroImage: article.heroImage,
          excerpt: article.excerpt,
          content: article.content,
          category: article.category,
          wordCount: article.wordCount,
          readingMinutes: article.readingMinutes,
          status: ArticleStatus.DRAFT,
          ...PUBLIC_ARTICLE_CREATE_FIELDS,
          publishedAt: article.publishedAt,
        },
        select: { id: true },
      });
      if (audit) {
        await recordAuditFromRequest(audit(row), tx);
      }
      return row;
    });
    return { status: "saved", id: created.id, article };
  } catch (err) {
    // A concurrent scrape created the same (sourceUrl, ownerId) first.
    if (isUniqueConstraintError(err)) {
      return duplicateSourceUrlOutcome(article.sourceUrl);
    }
    throw err;
  }
}

/** Scrapes a single URL and saves it, capturing failures as outcomes. */
export async function scrapeAndSave(url: string): Promise<SaveOutcome> {
  if (!isScraperFeatureEnabled()) {
    return failedOutcome("scraper is disabled", url);
  }
  try {
    const article = await scrapeUrl(url);
    if (!article) {
      return failedOutcome("could not extract article content", url);
    }
    // Run quality checks as a non-breaking signal. A "reject" grade usually
    // means the extractor produced obvious garbage; only long-enough articles
    // rejected for weak reading-time/metadata checks are recovered.
    const quality = checkContentQuality(article);
    if (isUnrecoverableQualityReject(article, quality)) {
      return failedOutcome(`content quality check failed (score=${quality.score})`, url);
    }
    return await saveDraftArticle(article);
  } catch (err) {
    return failedOutcome(errorMessage(err), url);
  }
}

function duplicateSourceUrlOutcome(
  sourceUrl: string,
): Extract<SaveOutcome, { status: "skipped" }> {
  return { status: "skipped", reason: DUPLICATE_SOURCE_URL_REASON, sourceUrl };
}

function failedOutcome(
  reason: string,
  sourceUrl: string,
): Extract<SaveOutcome, { status: "failed" }> {
  return { status: "failed", reason, sourceUrl };
}

function isUnrecoverableQualityReject(
  article: ScrapedArticle,
  quality: ReturnType<typeof checkContentQuality>,
): boolean {
  return quality.grade === "reject" && !isRecoverableQualityReject(article, quality);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// ── Content-source barrel re-exports ─────────────────────────────────────────
export type {
  SourceHealthStatus,
  CrawlCounters,
  CrawlRunOutcome,
  CrawlRunHistoryRow,
  ContentSourceRow,
  SyncContentSourcesResult,
  SourceHealthSummary,
} from "./sources";
export {
  HEALTH_THRESHOLDS,
  CRAWL_RUN_HISTORY_LIMIT,
  CRAWL_RUN_HISTORY_API_MAX_LIMIT,
  computeHealthStatus,
  applyCrawlOutcome,
  summarizeSourceHealth,
  syncContentSources,
  listContentSources,
  getContentSource,
  isProviderEnabled,
  setContentSourceEnabled,
  recordCrawlRun,
  listRecentCrawlRuns,
} from "./sources";
