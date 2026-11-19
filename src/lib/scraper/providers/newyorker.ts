import type { DiscoveredUrl, Provider, UrlExtractorResult } from "@/lib/scraper/types";
import {
  addArticleCandidates,
  candidateCap,
  categoryFromRules,
  discoveredFromSitemapEntry,
  hrefsFromHtml,
  parseSitemapEntries,
  rssUrlExtractor,
  urlWithoutQueryOrHash,
  type ArticleUrlRules,
} from "./shared";

const NEW_YORKER_BASE_URL = "https://www.newyorker.com";
const NEW_YORKER_SITEMAP_INDEX = `${NEW_YORKER_BASE_URL}/sitemap.xml`;
const NEW_YORKER_GOOGLE_NEWS_SITEMAP =
  `${NEW_YORKER_BASE_URL}/feed/google-news-sitemap-feed/sitemap-google-news`;
const NEW_YORKER_RSS_FEED = `${NEW_YORKER_BASE_URL}/feed/rss`;
const NEW_YORKER_FIRST_ARCHIVE_YEAR = 1925;
const NEW_YORKER_FIRST_ARCHIVE_MONTH = 2;
const NEW_YORKER_SITEMAP_CONCURRENCY = 6;
const NEW_YORKER_ARTICLE_URL_RE =
  /^https:\/\/(?:www\.)?newyorker\.com\/(?:magazine\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9._%+-]+|(?:news|culture|books|humor|science|tech|business|sports)\/[a-z0-9._%+-]+\/[a-z0-9._%+-]+)\/?(?:[?#].*)?$/i;
const NEW_YORKER_MONTHLY_SITEMAP_RE =
  /^https:\/\/(?:www\.)?newyorker\.com\/sitemap-(\d{4})-(\d{2})\.xml$/i;
const NEW_YORKER_SEEDS = [
  `${NEW_YORKER_BASE_URL}/`,
  `${NEW_YORKER_BASE_URL}/news`,
  `${NEW_YORKER_BASE_URL}/culture`,
  `${NEW_YORKER_BASE_URL}/books`,
  `${NEW_YORKER_BASE_URL}/humor`,
  `${NEW_YORKER_BASE_URL}/science`,
] as const;
const newYorkerRssFallback = rssUrlExtractor([NEW_YORKER_RSS_FEED]);

export function isNewYorkerArticleUrl(url: string): boolean {
  return NEW_YORKER_ARTICLE_URL_RE.test(url);
}

const NEW_YORKER_URLS: ArticleUrlRules = { normalize: urlWithoutQueryOrHash, isArticleUrl: isNewYorkerArticleUrl };

function sitemapTimestamp(url: string): number {
  const match = url.match(NEW_YORKER_MONTHLY_SITEMAP_RE);
  if (!match?.[1] || !match[2]) return 0;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
}

function newestMonthlySitemapsFirst(urls: readonly string[]): string[] {
  return [...new Set(urls)]
    .filter((url) => NEW_YORKER_MONTHLY_SITEMAP_RE.test(url))
    .sort((a, b) => sitemapTimestamp(b) - sitemapTimestamp(a));
}

/**
 * The public sitemap index only retains recent years, but the same monthly XML
 * route is available for the complete archive. Generate those stable routes so
 * `--all` can walk every issue from the first one in February 1925 onward.
 */
export function newYorkerMonthlySitemapUrls(now = new Date()): string[] {
  if (!Number.isFinite(now.getTime())) return [];

  const urls: string[] = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  while (
    year > NEW_YORKER_FIRST_ARCHIVE_YEAR ||
    (year === NEW_YORKER_FIRST_ARCHIVE_YEAR && month >= NEW_YORKER_FIRST_ARCHIVE_MONTH)
  ) {
    urls.push(`${NEW_YORKER_BASE_URL}/sitemap-${year}-${String(month).padStart(2, "0")}.xml`);
    month--;
    if (month === 0) {
      year--;
      month = 12;
    }
  }
  return urls;
}

async function fetchSitemapEntries(
  sourceUrl: string,
  fetch: Parameters<NonNullable<Provider["urlExtractor"]>>[0]["fetch"],
): Promise<DiscoveredUrl[]> {
  let entries: ReturnType<typeof parseSitemapEntries>;
  try {
    entries = parseSitemapEntries(await fetch(sourceUrl));
  } catch {
    return [];
  }

  const discovered: DiscoveredUrl[] = [];
  for (const entry of entries) {
    const candidate = discoveredFromSitemapEntry(entry, sourceUrl, NEW_YORKER_URLS);
    if (candidate) discovered.push(candidate);
  }
  return discovered;
}

async function collectSitemapEntries(
  urls: UrlExtractorResult[],
  seen: Set<string>,
  sourceUrl: string,
  fetch: Parameters<NonNullable<Provider["urlExtractor"]>>[0]["fetch"],
  cap: number,
): Promise<void> {
  addArticleCandidates(urls, seen, await fetchSitemapEntries(sourceUrl, fetch), cap, NEW_YORKER_URLS);
}

async function collectAllMonthlySitemapEntries(
  urls: UrlExtractorResult[],
  seen: Set<string>,
  sourceUrls: readonly string[],
  fetch: Parameters<NonNullable<Provider["urlExtractor"]>>[0]["fetch"],
  cap: number,
): Promise<void> {
  for (let offset = 0; offset < sourceUrls.length; offset += NEW_YORKER_SITEMAP_CONCURRENCY) {
    const batch = sourceUrls.slice(offset, offset + NEW_YORKER_SITEMAP_CONCURRENCY);
    const entriesBySource = await Promise.all(
      batch.map((sourceUrl) => fetchSitemapEntries(sourceUrl, fetch)),
    );
    for (const entries of entriesBySource) {
      addArticleCandidates(urls, seen, entries, cap, NEW_YORKER_URLS);
    }
  }
}

async function newYorkerUrlExtractor({
  limit,
  fetch,
}: Parameters<NonNullable<Provider["urlExtractor"]>>[0]): Promise<UrlExtractorResult[]> {
  const cap = candidateCap(limit);
  const seen = new Set<string>();
  const urls: UrlExtractorResult[] = [];

  await collectSitemapEntries(urls, seen, NEW_YORKER_GOOGLE_NEWS_SITEMAP, fetch, cap);

  let indexedSitemaps: string[] = [];
  try {
    indexedSitemaps = newestMonthlySitemapsFirst(
      parseSitemapEntries(await fetch(NEW_YORKER_SITEMAP_INDEX)).map((entry) => entry.url),
    );
  } catch {
    indexedSitemaps = [];
  }

  const generatedSitemaps = newYorkerMonthlySitemapUrls();
  const monthlySitemaps = Number.isFinite(limit)
    ? indexedSitemaps.length > 0
      ? indexedSitemaps
      : generatedSitemaps.slice(0, 12)
    : newestMonthlySitemapsFirst([...indexedSitemaps, ...generatedSitemaps]);

  if (Number.isFinite(limit)) {
    for (const sitemapUrl of monthlySitemaps) {
      if (urls.length >= cap) break;
      await collectSitemapEntries(urls, seen, sitemapUrl, fetch, cap);
    }
  } else {
    await collectAllMonthlySitemapEntries(urls, seen, monthlySitemaps, fetch, cap);
  }

  if (urls.length < cap) {
    addArticleCandidates(urls, seen, await newYorkerRssFallback({ limit, fetch }), cap, NEW_YORKER_URLS);
  }

  for (const seed of NEW_YORKER_SEEDS) {
    if (urls.length >= cap) break;
    try {
      addArticleCandidates(urls, seen, hrefsFromHtml(await fetch(seed), seed), cap, NEW_YORKER_URLS, seed);
    } catch {
      // Section pages supplement the archive; an unavailable page is non-fatal.
    }
  }

  return urls;
}

const newYorker: Provider = {
  key: "newyorker",
  name: "The New Yorker",
  hostnames: ["newyorker.com", "www.newyorker.com"],
  seeds: [...NEW_YORKER_SEEDS],
  articleUrlPattern: NEW_YORKER_ARTICLE_URL_RE,
  articleUrlFilter: isNewYorkerArticleUrl,
  defaultCategory: "culture",
  categories: [
    "culture",
    "ideas",
    "politics",
    "world",
    "business",
    "science",
    "environment",
    "health",
    "tech",
    "history",
    "entertainment",
    "sports",
  ],
  readingCategories: [
    "culture",
    "ideas",
    "politics",
    "world",
    "business",
    "science",
    "environment",
    "health",
    "tech",
    "history",
    "entertainment",
    "sports",
  ],
  extraction: {
    preferReadabilityForCollapsedJsonLd: true,
  },
  declutter: {
    terminalParagraphMarks: ["♦"],
  },
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/climate|environment|warming|conservation|energy|emissions?|weather/, "environment"],
        [/health|medicine|medical|disease|psychology|brain|food|nutrition/, "health"],
        [/science|research|physics|biology|evolution|space|astronomy/, "science"],
        [/technology|artificial.?intelligence|\bai\b|digital|internet|software|robot/, "tech"],
        [/business|financial|currency|econom|market|money|labor/, "business"],
        [/politic|election|government|congress|white.?house|supreme.?court|trump/, "politics"],
        [/global|international|letter.?from|world|war|foreign/, "world"],
        [/histor|archive|double.?take/, "history"],
        [/sports?|sporting.?scene|soccer|football|tennis|olympic/, "sports"],
        [/front.?row|cinema|television|music|theatre|film|movie/, "entertainment"],
        [/essay|comment|inquiry|personal.?history|ideas?/, "ideas"],
        [/books?|fiction|poem|culture|art|photo|food|humor|shouts/, "culture"],
      ],
      "culture",
    ),
  urlExtractor: newYorkerUrlExtractor,
  cleanup: {
    dropSelectors: ["video", "iframe", "aside"],
    dropClassKeywords: [
      "consumer-marketing-unit",
      "journey-unit",
      "newsletter",
      "paywall",
      "recirc",
      "summary-collection-grid",
      "summary-item",
    ],
    dropTextKeywords: [
      "Sign up for our newsletter",
      "Subscribe to The New Yorker",
    ],
    dropTextExactKeywords: ["Save this story"],
    dropLinkHrefBlockKeywords: ["aboutads.info"],
  },
};

export default newYorker;