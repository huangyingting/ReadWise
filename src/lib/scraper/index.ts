/**
 * Public barrel for the scraper subsystem.
 *
 * Persistence (saveDraftArticle, scrapeAndSave, scrapeUrl) lives here.
 * Discovery lives in `@/lib/scraper/discovery`.
 * Content-source governance lives in `@/lib/scraper/sources`.
 */
import { prisma } from "@/lib/prisma";
import { ArticleStatus, Prisma } from "@prisma/client";
import type { ScrapedArticle } from "@/lib/scraper/types";
import { extractArticle } from "@/lib/scraper/extract";
import { fetchHtml } from "@/lib/scraper/fetch";
import { isScraperFeatureEnabled } from "@/lib/runtime-config/feature-flags";
import { PUBLIC_ARTICLE_CREATE_FIELDS, findPublicLibraryArticleBySourceUrl } from "@/lib/article-library";
import { recordAuditFromRequest, type AuditRequestInput } from "@/lib/security/audit";

export type SaveOutcome =
  | { status: "saved"; id: string; article: ScrapedArticle }
  | { status: "skipped"; reason: string; sourceUrl: string }
  | { status: "failed"; reason: string; sourceUrl: string };

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
    return { status: "skipped", reason: "duplicate sourceUrl", sourceUrl: article.sourceUrl };
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
      return { status: "skipped", reason: "duplicate sourceUrl", sourceUrl: article.sourceUrl };
    }
    throw err;
  }
}

/** Scrapes a single URL and saves it, capturing failures as outcomes. */
export async function scrapeAndSave(url: string): Promise<SaveOutcome> {
  if (!isScraperFeatureEnabled()) {
    return { status: "failed", reason: "scraper is disabled", sourceUrl: url };
  }
  try {
    const article = await scrapeUrl(url);
    if (!article) {
      return { status: "failed", reason: "could not extract article content", sourceUrl: url };
    }
    return await saveDraftArticle(article);
  } catch (err) {
    return { status: "failed", reason: errorMessage(err), sourceUrl: url };
  }
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
  ContentSourceRow,
  SyncContentSourcesResult,
  SourceHealthSummary,
} from "./sources";
export {
  HEALTH_THRESHOLDS,
  computeHealthStatus,
  applyCrawlOutcome,
  summarizeSourceHealth,
  syncContentSources,
  listContentSources,
  getContentSource,
  isProviderEnabled,
  setContentSourceEnabled,
  recordCrawlRun,
} from "./sources";

