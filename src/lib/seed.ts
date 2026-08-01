import { PROVIDERS, getProvider } from "@/lib/scraper/providers";
import { discoverProviderUrls } from "@/lib/scraper/discovery";
import { scrapeAndSave, type SaveOutcome } from "@/lib/scraper";
import { processArticle, type ArticleProcessResult, type ProcessOptions } from "@/lib/processing/processor";
import { recordCrawlRun, type CrawlRunOutcome } from "@/lib/scraper/sources";
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

type ScrapeResult = "saved" | "duplicate" | "failed";

type ProviderRunStats = {
  scraped: number;
  duplicates: number;
  failed: number;
};

function createSeedStats(): SeedStats {
  return {
    discovered: 0,
    saved: 0,
    duplicates: 0,
    enriched: 0,
    published: 0,
    failed: 0,
    articleIds: [],
  };
}

/**
 * One-command seeder: scrapes a provider for sample articles and runs the full
 * enrichment pipeline (deterministic difficulty plus AI tags, vocabulary, quiz, translation) plus
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
  const stats = createSeedStats();

  const enrichOpts: ProcessOptions = { tts, translateLangs };
  const seen = new Set<string>();

  for (const provider of providers) {
    const startedAt = Date.now();
    const { urls, discoverError } = await discoverProviderArticles(
      provider,
      limit,
      deps,
      logger,
    );
    const providerStats: ProviderRunStats = {
      scraped: 0,
      duplicates: 0,
      failed: 0,
    };

    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      stats.discovered++;

      const { articleId, scrapeOutcome } = await scrapeOne(url, deps, stats, logger);
      countProviderScrape(providerStats, scrapeOutcome);
      if (!articleId) continue;

      const enriched = await enrichOne(articleId, enrichOpts, deps, stats, logger);
      if (enriched) stats.articleIds.push(articleId);
    }

    // Record provider health + ingestion quality for this run (RW-050).
    await recordProviderCrawl(provider, deps, logger, {
      discovered: urls.length,
      scraped: providerStats.scraped,
      failed: providerStats.failed,
      duplicates: providerStats.duplicates,
      rejected: 0,
      source: "seed",
      mode: "provider",
      durationMs: Date.now() - startedAt,
      error: discoverError,
    });
  }

  return stats;
}

async function discoverProviderArticles(
  provider: Provider,
  limit: number,
  deps: SeedDeps,
  logger: SeedLogger,
): Promise<{ urls: string[]; discoverError: string | null }> {
  logger.info(`Discovering up to ${limit} article(s) from ${provider.name}…`);
  let urls: string[] = [];
  let discoverError: string | null = null;
  try {
    urls = await deps.discover(provider, limit);
  } catch {
    discoverError = "crawl_discovery_failed";
    logger.error(`Discovery failed for ${provider.name}.`);
  }
  logger.info(`Found ${urls.length} article URL(s) from ${provider.name}.`);
  return { urls, discoverError };
}

function countProviderScrape(
  providerStats: ProviderRunStats,
  outcome: ScrapeResult,
): void {
  if (outcome === "saved") {
    providerStats.scraped++;
  } else if (outcome === "duplicate") {
    providerStats.duplicates++;
  } else {
    providerStats.failed++;
  }
}

async function recordProviderCrawl(
  provider: Provider,
  deps: SeedDeps,
  logger: SeedLogger,
  outcome: CrawlRunOutcome,
): Promise<void> {
  try {
    await deps.recordCrawl(provider.key, outcome);
  } catch {
    logger.warn(`Could not record crawl health for ${provider.name}.`);
  }
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
): Promise<{ articleId: string | null; scrapeOutcome: ScrapeResult }> {
  let outcome: SaveOutcome;
  try {
    outcome = await deps.scrapeAndSave(url);
  } catch {
    stats.failed++;
    logger.error("✗ scrape failed.");
    return { articleId: null, scrapeOutcome: "failed" };
  }

  if (outcome.status === "saved") {
    stats.saved++;
    logger.info(`✓ saved draft: ${outcome.id}`);
    return { articleId: outcome.id, scrapeOutcome: "saved" };
  }

  if (outcome.status === "skipped") {
    stats.duplicates++;
    logger.info("• article already exists.");
    return { articleId: await deps.resolveArticleId(url), scrapeOutcome: "duplicate" };
  }

  stats.failed++;
  logger.warn("✗ could not scrape article.");
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
  } catch {
    stats.failed++;
    logger.error(`✗ enrichment failed for ${articleId}.`);
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
    logger.warn(`⚠ enrichment had failures for ${articleId}.`);
  } else {
    logger.info(`✓ enriched ${articleId} (published=${result.published})`);
  }
  return true;
}
