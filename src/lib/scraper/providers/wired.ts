import type { DiscoveredUrl, Provider, UrlExtractorResult } from "@/lib/scraper/types";
import {
  candidateCap,
  categoryFromRules,
  extractorResultUrl,
  hrefsFromHtml,
  parseSitemapEntries,
  rssUrlExtractor,
} from "./shared";

const WIRED_SITEMAP_INDEX = "https://www.wired.com/sitemap.xml";
const WIRED_GOOGLE_NEWS_SITEMAP =
  "https://www.wired.com/feed/google-latest-news/sitemap-google-news";
const WIRED_RSS_FEED = "https://www.wired.com/feed/rss";
const WIRED_BASE_URL = "https://www.wired.com";
const WIRED_ARTICLE_URL_RE =
  /^https:\/\/(?:www\.)?wired\.com\/story\/[a-z0-9._%+-]+\/?(?:[?#].*)?$/i;
const WIRED_MONTHLY_SITEMAP_RE =
  /^https:\/\/(?:www\.)?wired\.com\/sitemap-\d{4}-\d{2}\.xml$/i;
const WIRED_STORY_SEEDS = [
  "https://www.wired.com/category/science/",
  "https://www.wired.com/category/security/",
  "https://www.wired.com/category/business/",
  "https://www.wired.com/category/culture/",
  "https://www.wired.com/category/gear/",
] as const;
const WIRED_SEEDS = [WIRED_BASE_URL + "/", ...WIRED_STORY_SEEDS] as const;
const WIRED_NON_EDITORIAL_SLUG_RE =
  /(?:^|-)(?:coupon|coupons|promo|promos|discount|deals?|sale)(?:-|$)|(?:coupon|promo)-codes?(?:-|$)|testing-products-/i;
const wiredRssFallback = rssUrlExtractor([WIRED_RSS_FEED]);

function normalizeCandidateUrl(raw: string, baseUrl?: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    url.hash = "";
    url.search = "";
    return url.href;
  } catch {
    return null;
  }
}

export function isWiredArticleUrl(url: string): boolean {
  if (!WIRED_ARTICLE_URL_RE.test(url)) return false;
  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    return !WIRED_NON_EDITORIAL_SLUG_RE.test(slug);
  } catch {
    return false;
  }
}

function sitemapTimestamp(url: string): number {
  const match = url.match(/sitemap-(\d{4})-(\d{2})\.xml$/i);
  if (!match?.[1] || !match[2]) return 0;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
}

function newestMonthlySitemapsFirst(urls: string[]): string[] {
  return [...new Set(urls)]
    .filter((url) => WIRED_MONTHLY_SITEMAP_RE.test(url))
    .sort((a, b) => sitemapTimestamp(b) - sitemapTimestamp(a));
}

function discoveredFromSitemapEntry(
  entry: { url: string; lastModified?: string },
  sourceUrl: string,
): DiscoveredUrl | null {
  const url = normalizeCandidateUrl(entry.url);
  if (!url || !isWiredArticleUrl(url)) return null;
  return {
    url,
    source: "sitemap",
    discoveredAt: new Date().toISOString(),
    sourceUrl,
    ...(entry.lastModified ? { lastModified: entry.lastModified } : {}),
  };
}

function addArticleCandidates(
  urls: UrlExtractorResult[],
  seen: Set<string>,
  candidates: readonly UrlExtractorResult[],
  cap: number,
  baseUrl?: string,
): number {
  let added = 0;
  for (const candidate of candidates) {
    if (urls.length >= cap) break;
    const normalized = normalizeCandidateUrl(extractorResultUrl(candidate), baseUrl);
    if (!normalized || !isWiredArticleUrl(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(typeof candidate === "string" ? normalized : { ...candidate, url: normalized });
    added++;
  }
  return added;
}

async function collectSitemapEntries(
  urls: UrlExtractorResult[],
  seen: Set<string>,
  sourceUrl: string,
  fetch: Parameters<NonNullable<Provider["urlExtractor"]>>[0]["fetch"],
  cap: number,
): Promise<void> {
  let entries: ReturnType<typeof parseSitemapEntries>;
  try {
    entries = parseSitemapEntries(await fetch(sourceUrl));
  } catch {
    return;
  }

  for (const entry of entries) {
    if (urls.length >= cap) break;
    const discovered = discoveredFromSitemapEntry(entry, sourceUrl);
    if (!discovered) continue;
    if (seen.has(discovered.url)) continue;
    seen.add(discovered.url);
    urls.push(discovered);
  }
}

async function wiredUrlExtractor({
  limit,
  fetch,
}: Parameters<NonNullable<Provider["urlExtractor"]>>[0]): Promise<UrlExtractorResult[]> {
  const cap = candidateCap(limit);
  const seen = new Set<string>();
  const urls: UrlExtractorResult[] = [];

  await collectSitemapEntries(urls, seen, WIRED_GOOGLE_NEWS_SITEMAP, fetch, cap);

  let monthlySitemaps: string[] = [];
  try {
    monthlySitemaps = newestMonthlySitemapsFirst(
      parseSitemapEntries(await fetch(WIRED_SITEMAP_INDEX)).map((entry) => entry.url),
    );
  } catch {
    monthlySitemaps = [];
  }
  for (const sitemapUrl of monthlySitemaps) {
    if (urls.length >= cap) break;
    await collectSitemapEntries(urls, seen, sitemapUrl, fetch, cap);
  }

  if (urls.length < cap) {
    addArticleCandidates(urls, seen, await wiredRssFallback({ limit, fetch }), cap);
  }

  for (const seed of WIRED_SEEDS) {
    if (urls.length >= cap) break;
    try {
      addArticleCandidates(urls, seen, hrefsFromHtml(await fetch(seed), seed), cap, seed);
    } catch {
      // Category pages are supplementary; sitemap/RSS discovery remains authoritative.
    }
  }

  return urls;
}

const wired: Provider = {
  key: "wired",
  name: "WIRED",
  hostnames: ["wired.com", "www.wired.com"],
  seeds: [...WIRED_SEEDS],
  articleUrlPattern: WIRED_ARTICLE_URL_RE,
  articleUrlFilter: isWiredArticleUrl,
  defaultCategory: "tech",
  categories: [
    "tech",
    "science",
    "environment",
    "health",
    "business",
    "culture",
    "ideas",
    "politics",
    "world",
    "travel",
    "entertainment",
    "animals",
    "sports",
  ],
  readingCategories: [
    "tech",
    "science",
    "environment",
    "health",
    "business",
    "culture",
    "ideas",
    "world",
    "travel",
    "entertainment",
    "animals",
  ],
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/health|medicine|disease|neuro|brain|sleep|fitness|nutrition|food|drug|fda|opioid|kratom|glp-?1|supplements?/, "health"],
        [/climate|environment|wildfire|energy|emissions?|conservation|sustainab|carbon|weather|heat.?dome|renewable|nuclear/, "environment"],
        [/animals?|wildlife|species|fossil|axolotl|fish|fungi|biology|evolution|paleontology/, "science"],
        [/security|cyber|privacy|surveillance|spyware|hack|ransomware|malware|password|encryption|breach/, "tech"],
        [/film|movie|tv|television|streaming|spotify|music|love.?island|games?|gaming|podcast|livestream/, "entertainment"],
        [/books?|book.?club|culture|romance|scams?|society|luddite|gen.?z|dating|food.?and.?drink/, "culture"],
        [/gear|gadget|how.?to|advice|apple|iphone|android|apps?|software|artificial.?intelligence|\bai\b|internet|social.?media|computer|computing|robot|data|cloud|phones?|smartphones?|electronics?|electric.?vehicle|evs?/, "tech"],
        [/business|startup|market|finance|prediction.?market|econom|labor|union|company|companies|consumer|price|dealership/, "business"],
        [/politic|policy|government|congress|white.?house|trump|law|court|police|military|defense|european.?union|\beu\b/, "politics"],
        [/space|nasa|astronomy|physics|science|research|scientists?|earthquake|math|statistics/, "science"],
        [/travel|airline|hotel|tourism|cities|destination/, "travel"],
        [/sports?|soccer|football|olympic|penalty.?shootout/, "sports"],
        [/ideas?|opinion|essay|plaintext/, "ideas"],
        [/world|china|mexico|venezuela|global|international/, "world"],
      ],
      "tech",
    ),
  urlExtractor: wiredUrlExtractor,
  cleanup: {
    dropSelectors: ["video", "iframe", "aside"],
    dropClassKeywords: [
      "bottom_recirc",
      "consumer-marketing-unit",
      "journey-unit",
      "paywall",
      "recirc-list",
      "summary-collection-grid",
      "summary-item",
    ],
    dropTextKeywords: [
      "Want more? Read all of our",
      "Subscribe to WIRED",
      "Save this story",
    ],
  },
};

export default wired;
