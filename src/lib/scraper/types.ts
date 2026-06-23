/**
 * Normalized result of scraping a single news article, ready to be persisted
 * as a draft Article. `content` is sanitized HTML; `sourceUrl` is the natural
 * de-duplication key.
 */
export type ScrapedArticle = {
  title: string;
  author: string | null;
  source: string;
  sourceUrl: string;
  heroImage: string | null;
  excerpt: string | null;
  content: string;
  category: string | null;
  publishedAt: Date | null;
  wordCount: number;
  readingMinutes: number;
};

/**
 * Injectable HTTP client passed to {@link Provider.urlExtractor}. Supports GET
 * (default) and POST so RSS, REST-JSON and GraphQL extractors share one type.
 * In tests, inject a stub that returns fixture data — no real network needed.
 */
export type ExtractorFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<string>;

/**
 * Context passed to a provider's optional
 * {@link Provider.urlExtractor} hook.
 */
export type UrlExtractorContext = {
  /** Total URL count requested — extractor may return more; caller enforces. */
  limit: number;
  /** SSRF-safe HTTP client. Injected in tests for zero-network execution. */
  fetch: ExtractorFetch;
};

/** A news source the scraper knows how to crawl and categorize. */
export type Provider = {
  /** Short CLI key, e.g. "nbc". */
  key: string;
  /** Human label stored as `Article.source`, e.g. "NBC News". */
  name: string;
  /** Hostnames (without protocol) whose URLs belong to this provider. */
  hostnames: string[];
  /** Section/landing pages used as crawl roots for `--provider` discovery. */
  seeds: string[];
  /** Matches URLs that look like article pages (vs. section/index pages). */
  articleUrlPattern: RegExp;
  /** Optional provider-specific filter for excluding live blogs, video pages, topic pages, etc. */
  articleUrlFilter?: (url: string) => boolean;
  /** Fallback category slug when one can't be inferred. */
  defaultCategory: string | null;
  /**
   * Optional provider-specific category resolver. Receives the article URL and
   * any section string found in metadata; returns one of our category slugs.
   */
  categoryFor?: (url: URL, section: string | null) => string | null;
  /**
   * Optional URL-discovery hook. When defined, `discoverProviderUrls` calls
   * this extractor **instead of** the seed-HTML crawler. The extractor receives
   * an injectable fetch so tests never touch a real network.
   *
   * Extractor results are still validated against `articleUrlPattern`,
   * `articleUrlFilter`, robots rules, and the provider's hostname before use.
   */
  urlExtractor?: (ctx: UrlExtractorContext) => Promise<string[]>;
  /**
   * Optional paginated seed-URL builder for HTML-discovery providers. Called
   * with `(seed, pageNum)` where `pageNum` starts at **2** (page 1 is the
   * plain seed URL). Return `null` when the seed has no further pages.
   *
   * Requires {@link maxSeedPages} > 1 to take effect.
   */
  paginateSeed?: (seed: string, page: number) => string | null;
  /**
   * Maximum pages to crawl per seed during HTML-based discovery.
   * Defaults to 1 (no pagination). Requires {@link paginateSeed}.
   */
  maxSeedPages?: number;
};
