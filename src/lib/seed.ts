import { PROVIDERS, getProvider } from "@/lib/scraper/providers";
import { discoverProviderUrls, scrapeAndSave, type SaveOutcome } from "@/lib/scraper";
import { processArticle, type ArticleProcessResult, type ProcessOptions } from "@/lib/processing/processor";
import { recordCrawlRun, type CrawlRunOutcome } from "@/lib/content-sources";
import type { Provider } from "@/lib/scraper/types";
import { findPublicLibraryArticleBySourceUrl } from "@/lib/article-library";

export type SeedLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export const noopLogger: SeedLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Dependencies the seeder relies on. Injectable so the orchestration can be
 * unit-tested without a database or network access.
 */
export type SeedDeps = {
  discover: (provider: Provider, limit: number) => Promise<string[]>;
  scrapeAndSave: (url: string) => Promise<SaveOutcome>;
  resolveArticleId: (sourceUrl: string) => Promise<string | null>;
  process: (articleId: string, opts: ProcessOptions) => Promise<ArticleProcessResult | null>;
  /** Records per-provider crawl health/ingestion metrics (RW-050). */
  recordCrawl: (providerKey: string, outcome: CrawlRunOutcome) => Promise<void>;
};

const defaultDeps: SeedDeps = {
  discover: discoverProviderUrls,
  scrapeAndSave,
  resolveArticleId: async (sourceUrl) => {
    const existing = await findPublicLibraryArticleBySourceUrl(sourceUrl);
    return existing?.id ?? null;
  },
  process: processArticle,
  recordCrawl: async (providerKey, outcome) => {
    await recordCrawlRun(providerKey, outcome);
  },
};

export type SeedOptions = {
  /** Provider keys to seed from. Defaults to the first registered provider. */
  providerKeys?: string[];
  /** Max articles to scrape per provider (default 3). */
  limit?: number;
  /** Generate text-to-speech narration during enrichment (default true). */
  tts?: boolean;
  /** Pre-generate translations for these language codes. */
  translateLangs?: string[];
  logger?: SeedLogger;
  deps?: Partial<SeedDeps>;
};

export type SeedStats = {
  /** Distinct article URLs discovered across all providers. */
  discovered: number;
  /** Newly scraped + saved draft articles. */
  saved: number;
  /** URLs skipped because the article already existed (de-duplication). */
  duplicates: number;
  /** Articles that ran through enrichment. */
  enriched: number;
  /** Articles published (or already published) after enrichment. */
  published: number;
  /** Articles where scraping or enrichment failed. */
  failed: number;
  /** Article ids that were seeded (saved or pre-existing) and enriched. */
  articleIds: string[];
};

export const DEFAULT_SEED_LIMIT = 3;

/**
 * One-command seeder: scrapes a provider for sample articles and runs the full
 * AI enrichment pipeline (difficulty, tags, vocabulary, quiz, translation) plus
 * TTS narration on each.
 *
 * Idempotent end-to-end: `scrapeAndSave` de-duplicates by `sourceUrl` and the
 * processor is cache-first, so re-running the seeder never creates duplicate
 * articles or regenerates already-enriched content.
 */
export async function runSeed(options: SeedOptions = {}): Promise<SeedStats> {
  const logger = options.logger ?? noopLogger;
  const deps: SeedDeps = { ...defaultDeps, ...options.deps };
  const limit = Math.max(1, options.limit ?? DEFAULT_SEED_LIMIT);
  const tts = options.tts ?? true;
  const translateLangs = options.translateLangs ?? [];

  const providers = resolveProviders(options.providerKeys);

  const stats: SeedStats = {
    discovered: 0,
    saved: 0,
    duplicates: 0,
    enriched: 0,
    published: 0,
    failed: 0,
    articleIds: [],
  };

  const enrichOpts: ProcessOptions = { tts, translateLangs };
  const seen = new Set<string>();

  for (const provider of providers) {
    logger.info(`Discovering up to ${limit} article(s) from ${provider.name}…`);
    let urls: string[] = [];
    let discoverError: string | null = null;
    try {
      urls = await deps.discover(provider, limit);
    } catch (err) {
      discoverError = errorMessage(err);
      logger.error(`Discovery failed for ${provider.name}: ${discoverError}`);
    }
    logger.info(`Found ${urls.length} article URL(s) from ${provider.name}.`);

    let providerScraped = 0;
    let providerDuplicates = 0;
    let providerFailed = 0;

    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      stats.discovered++;

      const { articleId, scrapeOutcome } = await scrapeOne(url, deps, stats, logger);
      if (scrapeOutcome === "saved") providerScraped++;
      else if (scrapeOutcome === "duplicate") providerDuplicates++;
      else providerFailed++;
      if (!articleId) continue;

      const enriched = await enrichOne(articleId, enrichOpts, deps, stats, logger);
      if (enriched) stats.articleIds.push(articleId);
    }

    // Record provider health + ingestion quality for this run (RW-050).
    try {
      await deps.recordCrawl(provider.key, {
        discovered: urls.length,
        scraped: providerScraped,
        failed: providerFailed,
        duplicates: providerDuplicates,
        rejected: 0,
        error: discoverError,
      });
    } catch (err) {
      logger.warn(
        `Could not record crawl health for ${provider.name}: ${errorMessage(err)}`,
      );
    }
  }

  return stats;
}

function resolveProviders(keys?: string[]): Provider[] {
  if (!keys || keys.length === 0) {
    return [PROVIDERS[0]];
  }
  const resolved: Provider[] = [];
  for (const key of keys) {
    if (key.toLowerCase() === "all") {
      return [...PROVIDERS];
    }
    const provider = getProvider(key);
    if (provider) {
      if (!resolved.includes(provider)) resolved.push(provider);
    }
  }
  return resolved.length > 0 ? resolved : [PROVIDERS[0]];
}

/** Scrapes+saves a single URL, returning its article id (existing or new). */
async function scrapeOne(
  url: string,
  deps: SeedDeps,
  stats: SeedStats,
  logger: SeedLogger,
): Promise<{ articleId: string | null; scrapeOutcome: "saved" | "duplicate" | "failed" }> {
  let outcome: SaveOutcome;
  try {
    outcome = await deps.scrapeAndSave(url);
  } catch (err) {
    stats.failed++;
    logger.error(`✗ scrape failed: ${url} — ${errorMessage(err)}`);
    return { articleId: null, scrapeOutcome: "failed" };
  }

  if (outcome.status === "saved") {
    stats.saved++;
    logger.info(`✓ saved draft: ${outcome.article.title}`);
    return { articleId: outcome.id, scrapeOutcome: "saved" };
  }

  if (outcome.status === "skipped") {
    stats.duplicates++;
    logger.info(`• already exists: ${url}`);
    return { articleId: await deps.resolveArticleId(url), scrapeOutcome: "duplicate" };
  }

  stats.failed++;
  logger.warn(`✗ could not scrape ${url}: ${outcome.reason}`);
  return { articleId: null, scrapeOutcome: "failed" };
}

/** Runs the full enrichment pipeline on one article id. */
async function enrichOne(
  articleId: string,
  opts: ProcessOptions,
  deps: SeedDeps,
  stats: SeedStats,
  logger: SeedLogger,
): Promise<boolean> {
  let result: ArticleProcessResult | null;
  try {
    result = await deps.process(articleId, opts);
  } catch (err) {
    stats.failed++;
    logger.error(`✗ enrichment threw for ${articleId}: ${errorMessage(err)}`);
    return false;
  }

  if (!result) {
    stats.failed++;
    logger.warn(`✗ article vanished before enrichment: ${articleId}`);
    return false;
  }

  stats.enriched++;
  if (result.published) stats.published++;
  if (!result.ok) {
    stats.failed++;
    logger.warn(`⚠ enrichment had failures for "${result.title}"`);
  } else {
    logger.info(`✓ enriched "${result.title}" (published=${result.published})`);
  }
  return true;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
