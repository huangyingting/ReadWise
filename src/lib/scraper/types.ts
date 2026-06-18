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
  /** Fallback category slug when one can't be inferred. */
  defaultCategory: string | null;
  /**
   * Optional provider-specific category resolver. Receives the article URL and
   * any section string found in metadata; returns one of our category slugs.
   */
  categoryFor?: (url: URL, section: string | null) => string | null;
};
