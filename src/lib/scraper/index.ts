/**
 * Public barrel for the scraper subsystem.
 *
 * Public-library URL intake (`scrapeAndSave`) owns feature gating, extraction,
 * quality policy, dedupe, persistence, optional audit, and outcome mapping.
 * `saveDraftArticle` remains available for already-extracted input.
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

export type SaveAuditFactory = (created: { id: string }) => AuditRequestInput;

export type UrlIntakeFailureKind =
  | "disabled"
  | "scrape"
  | "extract"
  | "quality"
  | "save";

export type UrlIntakeOutcome =
  | Extract<SaveOutcome, { status: "saved" | "skipped" }>
  | (Extract<SaveOutcome, { status: "failed" }> & {
      failure: UrlIntakeFailureKind;
    });

const DUPLICATE_SOURCE_URL_REASON = "duplicate sourceUrl";
const INTAKE_FAILURE_REASON: Record<UrlIntakeFailureKind, string> = {
  disabled: "scraper_disabled",
  scrape: "article_fetch_failed",
  extract: "article_extraction_failed",
  quality: "article_quality_failed",
  save: "article_persistence_failed",
};

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
  audit?: SaveAuditFactory,
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

/**
 * Runs canonical public-library URL intake and captures every failure as a
 * structured outcome. Audit data, when supplied, is written in the same
 * transaction as the new ownerless draft.
 */
export async function scrapeAndSave(
  url: string,
  audit?: SaveAuditFactory,
): Promise<UrlIntakeOutcome> {
  if (!isScraperFeatureEnabled()) {
    return failedIntakeOutcome("disabled", INTAKE_FAILURE_REASON.disabled, url);
  }

  let article: ScrapedArticle | null;
  try {
    article = await scrapeUrl(url);
  } catch {
    return failedIntakeOutcome("scrape", INTAKE_FAILURE_REASON.scrape, url);
  }
  if (!article) {
    return failedIntakeOutcome("extract", INTAKE_FAILURE_REASON.extract, url);
  }

  try {
    const quality = checkContentQuality(article);
    if (isUnrecoverableQualityReject(article, quality)) {
      return failedIntakeOutcome(
        "quality",
        INTAKE_FAILURE_REASON.quality,
        url,
      );
    }
  } catch {
    return failedIntakeOutcome("quality", INTAKE_FAILURE_REASON.quality, url);
  }

  try {
    const outcome = await saveDraftArticle(article, audit);
    return outcome.status === "failed"
      ? { ...outcome, failure: "save" }
      : outcome;
  } catch {
    return failedIntakeOutcome("save", INTAKE_FAILURE_REASON.save, url);
  }
}

function duplicateSourceUrlOutcome(
  sourceUrl: string,
): Extract<SaveOutcome, { status: "skipped" }> {
  return { status: "skipped", reason: DUPLICATE_SOURCE_URL_REASON, sourceUrl };
}

function failedIntakeOutcome(
  failure: UrlIntakeFailureKind,
  reason: string,
  sourceUrl: string,
): Extract<UrlIntakeOutcome, { status: "failed" }> {
  return { status: "failed", failure, reason, sourceUrl };
}

function isUnrecoverableQualityReject(
  article: ScrapedArticle,
  quality: ReturnType<typeof checkContentQuality>,
): boolean {
  return quality.grade === "reject" && !isRecoverableQualityReject(article, quality);
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
