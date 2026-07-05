/**
 * Shared category-mapping and URL-filter helpers used by provider modules.
 *
 * Centralizing these utilities means individual provider files only express
 * their own rules; they never duplicate the regex-matching plumbing.
 */
import { CATEGORY_SLUGS, isReadingRecommended } from "@/lib/categories";
import { parseRssEntries } from "@/lib/scraper/rss";
import type {
  DiscoveredUrl,
  Provider,
  UrlExtractor,
  UrlExtractorContext,
  UrlExtractorResult,
} from "@/lib/scraper/types";

export type SitemapEntry = {
  url: string;
  lastModified?: string;
};

export function extractorResultUrl(candidate: UrlExtractorResult): string {
  return typeof candidate === "string" ? candidate : candidate.url;
}

export const COMMON_READING_SOURCE_CLEANUP = {
  dropClassKeywords: [
    "advert",
    "newsletter",
    "promo",
    "recirc",
    "related",
    "share",
    "social",
  ],
  dropTextKeywords: [
    "sign up for our newsletter",
    "subscribe to our newsletter",
    "support our journalism",
  ],
};

export function candidateCap(limit: number): number {
  return Number.isFinite(limit) ? Math.max(limit * 2, limit) : Number.POSITIVE_INFINITY;
}

export function addUnique(seen: Set<string>, urls: string[], url: string, cap: number): boolean {
  if (urls.length >= cap || seen.has(url)) return false;
  seen.add(url);
  urls.push(url);
  return urls.length >= cap;
}

export function validUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function hostnameWithoutWww(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

export function isPath(url: string, hostname: string, pattern: RegExp): boolean {
  const parsed = validUrl(url);
  return Boolean(parsed && hostnameWithoutWww(parsed) === hostname && pattern.test(parsed.pathname));
}

function normalizeAbsoluteUrl(raw: string, baseUrl: string): string | null {
  try {
    return new URL(raw, baseUrl).href.split("#")[0] ?? raw;
  } catch {
    return null;
  }
}

export function hrefsFromHtml(html: string, baseUrl: string): string[] {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)]
    .map((match) => normalizeAbsoluteUrl(match[1] ?? "", baseUrl))
    .filter((url): url is string => Boolean(url));
}

export async function collectSitemapUrls(
  sitemapUrls: readonly string[],
  ctx: UrlExtractorContext,
  keepUrl: (url: string) => boolean,
): Promise<string[]> {
  const cap = candidateCap(ctx.limit);
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const sitemapUrl of sitemapUrls) {
    if (urls.length >= cap) break;
    let locs: string[];
    try {
      locs = parseSitemapLocs(await ctx.fetch(sitemapUrl));
    } catch {
      continue;
    }
    for (const url of locs) {
      if (!keepUrl(url)) continue;
      if (addUnique(seen, urls, url, cap)) break;
    }
  }
  return urls;
}

function addUniqueUrl<T extends { url: string }>(seen: Set<string>, urls: T[], entry: T): boolean {
  if (seen.has(entry.url)) return false;
  seen.add(entry.url);
  urls.push(entry);
  return true;
}

function sitemapEntry(url: string, lastModified: string | undefined, sourceUrl: string): DiscoveredUrl {
  return {
    url,
    source: "sitemap",
    discoveredAt: new Date().toISOString(),
    sourceUrl,
    ...(lastModified ? { lastModified } : {}),
  };
}

function rssEntry(url: string, publishedAt: string | undefined, sourceUrl: string): DiscoveredUrl {
  return {
    url,
    source: "rss",
    discoveredAt: new Date().toISOString(),
    sourceUrl,
    ...(publishedAt ? { publishedAt } : {}),
  };
}

/**
 * Builds a {@link Provider.urlExtractor} that discovers article URLs from one
 * or more RSS 2.0 / Atom feeds. Each feed is fetched via the injected
 * `ctx.fetch` (so tests stay network-free), parsed with {@link parseRssEntries},
 * and the results are deduplicated across feeds.
 *
 * Feeds are fetched in order until roughly `2 × limit` candidates are
 * collected (discovery enforces the hard `limit` after pattern/filter/robots
 * validation). A feed that throws or returns nothing is skipped gracefully so
 * one unreachable feed never aborts discovery.
 *
 * Returned entries are raw candidates with source metadata —
 * `discoverProviderUrls` still validates each against the provider's hostname,
 * `articleUrlPattern`, `articleUrlFilter` and robots rules.
 */
export function rssUrlExtractor(
  feedUrls: readonly string[],
): UrlExtractor {
  const feeds = [...new Set(feedUrls)];
  return async ({ limit, fetch: fetchFn }) => {
    const seen = new Set<string>();
    const urls: DiscoveredUrl[] = [];
    for (const feedUrl of feeds) {
      if (urls.length >= limit * 2) break;
      try {
        const xml = await fetchFn(feedUrl);
        for (const entry of parseRssEntries(xml)) {
          addUniqueUrl(seen, urls, rssEntry(entry.url, entry.publishedAt, feedUrl));
        }
      } catch {
        // graceful degradation — a single feed failure doesn't stop discovery
      }
    }
    return urls;
  };
}

type SitemapUrlExtractorOptions = {
  sitemapUrlFilter?: (url: string) => boolean;
};

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function parseSitemapLocs(xml: string): string[] {
  return parseSitemapEntries(xml).map((entry) => entry.url);
}

export function parseSitemapEntries(xml: string): SitemapEntry[] {
  const blocks = [...xml.matchAll(/<(?:url|sitemap)\b[^>]*>([\s\S]*?)<\/(?:url|sitemap)>/gi)]
    .map((match) => match[1] ?? "");
  const source = blocks.length > 0 ? blocks : [xml];
  const entries: SitemapEntry[] = [];
  const seen = new Set<string>();
  for (const block of source) {
    const rawLoc = tagText(block, "loc");
    if (!rawLoc) continue;
    const url = decodeXmlText(rawLoc);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const lastModified = normalizeXmlDate(tagText(block, "lastmod"));
    entries.push({
      url,
      ...(lastModified ? { lastModified } : {}),
    });
  }
  return entries;
}

function tagText(xml: string, tagName: string): string | undefined {
  const match = xml.match(new RegExp(`<${tagName}\\b[^>]*>\\s*([^<]+?)\\s*</${tagName}>`, "i"));
  return match?.[1] ? decodeXmlText(match[1].trim()) : undefined;
}

function normalizeXmlDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

export function sitemapUrlExtractor(
  sitemapIndexUrl: string,
  options: SitemapUrlExtractorOptions = {},
): UrlExtractor {
  return async ({ limit, fetch: fetchFn }) => {
    const seen = new Set<string>();
    const urls: DiscoveredUrl[] = [];
    const candidateCap = Number.isFinite(limit)
      ? Math.max(limit * 2, limit)
      : Number.POSITIVE_INFINITY;

    let indexLocs: SitemapEntry[];
    try {
      indexLocs = parseSitemapEntries(await fetchFn(sitemapIndexUrl));
    } catch {
      return [];
    }

    const childSitemaps = options.sitemapUrlFilter
      ? indexLocs.filter((entry) => options.sitemapUrlFilter?.(entry.url))
      : indexLocs;

    for (const sitemap of childSitemaps) {
      if (urls.length >= candidateCap) break;
      let locs: SitemapEntry[];
      try {
        locs = parseSitemapEntries(await fetchFn(sitemap.url));
      } catch {
        continue;
      }
      for (const entry of locs) {
        if (
          addUniqueUrl(
            seen,
            urls,
            sitemapEntry(entry.url, entry.lastModified, sitemap.url),
          ) &&
          urls.length >= candidateCap
        ) {
          break;
        }
      }
    }

    return urls;
  };
}

/**
 * Maps a free-form section/topic string (from a URL path or article metadata)
 * onto one of our canonical category slugs. Returns null when nothing matches.
 */
export function mapSectionToCategory(section: string | null): string | null {
  if (!section) return null;
  const s = section.toLowerCase();

  const rules: Array<[RegExp, string]> = [
    // Science is checked FIRST so biology/mind/"science-nature" sections beat the
    // broad `world` ("living world") and `environment` ("science & nature") rules.
    [/\b((?<!social[\s.-])science|living.?world|the.?mind|\bmind\b|biolog|zoolog|evolution|paleontolog|psycholog|neuroscience|astronom|astrophysic|physic|chemist|\bmath|mathematic|genetic|cosmos|space|geolog|quantum)/, "science"],
    [/\b(animals?|wildlife|species|endangered|extinction|fauna|creature|\bpets?\b|marine[\s.-]?life|safari)\b/, "animals"],
    [/\b(world|global|international|asia|europe|africa|americas|middle.?east)/, "world"],
    [/\b(politic|election|congress|white.?house|government|policy)/, "politics"],
    [/\b(business|money|econom|market|finance|deal|compan|industr)/, "business"],
    [/\b(health|wellness|coronavirus|covid|medic|fitness|disease)/, "health"],
    [/\b(idea|philosoph|essay|opinion|ethic|consciousness|metaphysic|existential|the-?conversation)/, "ideas"],
    [/\b(histor|archaeolog|ancient|medieval|heritage|civil.?war|antiquit)/, "history"],
    [/\b(travel|destination|tourism|vacation|expedition|journey)/, "travel"],
    [/\b(environment|climate|sustainab|conservation|ecolog|biodiversit|pollution|carbon|emission|ecosystem|habitat|nature|ocean|planet|earth)/, "environment"],
    [/\b(tech|gadget|software|hardware|\bai\b|artificial.?intelligence|innovation|computing|robotic|internet|digital)/, "tech"],
    [/\b(sport|nfl|nba|mlb|soccer|football|olympic)/, "sports"],
    [/\b(culture|art|book|style|food|fashion|design|\bsociety\b|social.?science)/, "culture"],
    [/\b(entertainment|celebrit|tv|television|movie|film|music|hollywood|gaming|game)/, "entertainment"],
  ];

  for (const [pattern, slug] of rules) {
    if (pattern.test(s) && CATEGORY_SLUGS.includes(slug)) {
      return slug;
    }
  }
  return null;
}

/** Picks the first non-empty path segment of a URL (e.g. "/health/foo" → "health"). */
function firstSegment(url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  return segments[0] ?? null;
}

function categoryFromRuleMatch(
  haystack: string,
  rules: ReadonlyArray<readonly [RegExp, string]>,
): string | null {
  for (const [pattern, slug] of rules) {
    if (pattern.test(haystack) && CATEGORY_SLUGS.includes(slug)) return slug;
  }
  return null;
}

/** Derives a category from the first path segment, falling back through section metadata. */
export const categoryFromFirstSegment = (url: URL, section: string | null): string | null =>
  mapSectionToCategory(section) ?? mapSectionToCategory(firstSegment(url));

/**
 * Evaluates a provider's category rules against the URL path + section string.
 * Falls back to `categoryFromFirstSegment` then `fallback` when no rule fires.
 */
export function categoryFromRules(
  url: URL,
  section: string | null,
  rules: ReadonlyArray<readonly [RegExp, string]>,
  fallback: string | null,
): string | null {
  const haystack = `${section ?? ""} ${url.pathname}`.toLowerCase();
  return (
    categoryFromRuleMatch(haystack, rules) ??
    categoryFromFirstSegment(url, section) ??
    fallback
  );
}

/**
 * Like {@link categoryFromRules} but returns `null` when no rule matches —
 * letting the extract pipeline fall through to `mapSectionToCategory` and the
 * provider's `defaultCategory`. Used by providers with idiosyncratic section
 * labels where some labels (e.g. newsletter formats) should NOT force a slug.
 */
export function lookupSection(
  url: URL,
  section: string | null,
  rules: ReadonlyArray<readonly [RegExp, string]>,
): string | null {
  const haystack = `${section ?? ""} ${url.pathname}`.toLowerCase();
  return categoryFromRuleMatch(haystack, rules);
}

/**
 * Returns true when `url` does NOT contain any of the given `fragments`.
 * Used in `articleUrlFilter` to exclude live-blogs, video pages, etc.
 */
export function excludes(url: string, fragments: readonly string[]): boolean {
  const lower = url.toLowerCase();
  return !fragments.some((fragment) => lower.includes(fragment));
}

/**
 * Categories of a provider recommended for English reading practice. Returns the
 * provider's explicit `readingCategories` override when set, otherwise the
 * default = `categories[]` intersected with the global READING_RECOMMENDED tier
 * (high/medium suitability). PURE — provider metadata only.
 */
export function providerReadingCategories(provider: Provider): string[] {
  const categories = provider.categories ?? [];
  return provider.readingCategories ?? categories.filter(isReadingRecommended);
}

/**
 * True when `category` is recommended for reading practice for this specific
 * provider — honouring its `readingCategories` override when present. A null
 * category is never reading-suitable.
 */
export function isProviderCategoryReadingSuitable(
  provider: Provider,
  category: string | null,
): boolean {
  if (category == null) return false;
  return providerReadingCategories(provider).includes(category);
}
