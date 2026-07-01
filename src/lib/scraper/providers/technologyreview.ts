import type { Provider } from "@/lib/scraper/types";
import { excludes, lookupSection, parseSitemapLocs, rssUrlExtractor } from "./shared";

const TECHNOLOGY_REVIEW_SITEMAP_INDEX = "https://www.technologyreview.com/sitemap.xml";
const TECHNOLOGY_REVIEW_NEWS_SITEMAP = "https://www.technologyreview.com/news-sitemap.xml";
const TECHNOLOGY_REVIEW_WP_POSTS_API =
  "https://www.technologyreview.com/wp-json/wp/v2/posts";
const TECHNOLOGY_REVIEW_WP_POSTS_PAGE_SIZE = 100;
const TECHNOLOGY_REVIEW_ARTICLE_URL_RE =
  /^https:\/\/(?:www\.)?technologyreview\.com\/\d{4}\/\d{2}\/\d{2}\/\d+\/[a-z0-9-]+\/?(?:[?#].*)?$/i;
const TECHNOLOGY_REVIEW_EXCLUDED_URL_FRAGMENTS = [
  "/author/",
  "/topic/",
  "/newsletter/",
  "/the-download-",
  "/podcasts/",
  "/events/",
  "/lists/",
  "/subscribe",
  "/about",
  "/sitemap",
];
const TECHNOLOGY_REVIEW_SEEDS = [
  "https://www.technologyreview.com/topic/artificial-intelligence",
  "https://www.technologyreview.com/topic/biotechnology",
  "https://www.technologyreview.com/topic/climate-change",
  "https://www.technologyreview.com/topic/computing",
  "https://www.technologyreview.com/topic/business",
  "https://www.technologyreview.com/topic/culture",
  "https://www.technologyreview.com/topic/space",
];
const TECHNOLOGY_REVIEW_RSS_FEEDS = [
  "https://www.technologyreview.com/feed/",
  ...TECHNOLOGY_REVIEW_SEEDS.map((seed) => `${seed.replace(/\/$/, "")}/feed/`),
];
const technologyReviewRssFallback = rssUrlExtractor(TECHNOLOGY_REVIEW_RSS_FEEDS);

function sitemapNumber(url: string): number {
  const match = url.match(/\/sitemap-(\d+)\.xml$/i);
  return match?.[1] ? Number(match[1]) : 0;
}

function isContentSitemap(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.replace(/^www\./, "") === "technologyreview.com" &&
      /^\/(?:sitemap-\d+|news-sitemap)\.xml$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function isSitemapIndex(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.replace(/^www\./, "") === "technologyreview.com" &&
      /^\/sitemap-index-\d+\.xml$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function sortSitemapsNewestFirst(urls: string[]): string[] {
  return [...new Set(urls)].sort((a, b) => sitemapNumber(b) - sitemapNumber(a));
}

function candidateCap(limit: number): number {
  return Number.isFinite(limit)
    ? Math.max(limit * 10, limit + 500)
    : Number.POSITIVE_INFINITY;
}

function normalizeCandidateUrl(raw: string, baseUrl?: string): string | null {
  try {
    return new URL(raw, baseUrl).href.split("#")[0];
  } catch {
    return null;
  }
}

function isArticleCandidate(url: string): boolean {
  return (
    TECHNOLOGY_REVIEW_ARTICLE_URL_RE.test(url) &&
    excludes(url, TECHNOLOGY_REVIEW_EXCLUDED_URL_FRAGMENTS)
  );
}

function parseRobotsSitemaps(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*sitemap:\s*(\S+)\s*$/i)?.[1] ?? "")
    .filter(Boolean);
}

function parseHtmlArticleLinks(html: string, baseUrl: string): string[] {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)]
    .map((match) => normalizeCandidateUrl(match[1] ?? "", baseUrl))
    .filter((url): url is string => url != null && isArticleCandidate(url));
}

function parseWpPostLinks(json: string): string[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (item == null || typeof item !== "object") return null;
      const value = "link" in item ? item.link : "url" in item ? item.url : null;
      return typeof value === "string" ? value : null;
    })
    .filter((url): url is string => url != null);
}

function wpPostsApiUrl(page: number): string {
  return `${TECHNOLOGY_REVIEW_WP_POSTS_API}?per_page=${TECHNOLOGY_REVIEW_WP_POSTS_PAGE_SIZE}&page=${page}&_fields=link`;
}

async function technologyReviewUrlExtractor({
  limit,
  fetch,
}: Parameters<NonNullable<Provider["urlExtractor"]>>[0]): Promise<string[]> {
  const cap = candidateCap(limit);
  const seen = new Set<string>();
  const urls: string[] = [];
  const add = (candidates: readonly string[], baseUrl?: string) => {
    let added = 0;
    for (const url of candidates) {
      if (urls.length >= cap) break;
      const normalized = normalizeCandidateUrl(url, baseUrl);
      if (!normalized || !isArticleCandidate(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
      added++;
    }
    return added;
  };
  const reachedCap = () => urls.length >= cap;

  const visitedSitemaps = new Set<string>();
  const addSitemapTree = async (sitemapUrl: string): Promise<void> => {
    if (reachedCap() || visitedSitemaps.has(sitemapUrl)) return;
    visitedSitemaps.add(sitemapUrl);

    let locs: string[];
    try {
      locs = parseSitemapLocs(await fetch(sitemapUrl));
    } catch {
      return;
    }

    add(locs);
    const childIndexes = locs.filter(isSitemapIndex);
    for (const indexUrl of childIndexes) {
      if (reachedCap()) break;
      await addSitemapTree(indexUrl);
    }

    const childSitemaps = sortSitemapsNewestFirst(locs.filter(isContentSitemap));
    for (const childUrl of childSitemaps) {
      if (reachedCap()) break;
      await addSitemapTree(childUrl);
    }
  };

  const sitemapRoots = new Set([TECHNOLOGY_REVIEW_SITEMAP_INDEX, TECHNOLOGY_REVIEW_NEWS_SITEMAP]);
  try {
    for (const sitemapUrl of parseRobotsSitemaps(await fetch("https://www.technologyreview.com/robots.txt"))) {
      if (isSitemapIndex(sitemapUrl) || isContentSitemap(sitemapUrl)) sitemapRoots.add(sitemapUrl);
    }
  } catch {
    // The known sitemap roots above are still attempted when robots.txt is unavailable.
  }

  for (const sitemapUrl of sitemapRoots) {
    if (reachedCap()) break;
    await addSitemapTree(sitemapUrl);
  }

  for (let page = 1; !reachedCap(); page++) {
    let links: string[];
    try {
      links = parseWpPostLinks(await fetch(wpPostsApiUrl(page)));
    } catch {
      break;
    }
    if (links.length === 0) break;
    add(links);
    if (links.length < TECHNOLOGY_REVIEW_WP_POSTS_PAGE_SIZE) break;
  }

  if (!reachedCap()) add(await technologyReviewRssFallback({ limit, fetch }));

  for (const seed of TECHNOLOGY_REVIEW_SEEDS) {
    if (reachedCap()) break;
    try {
      add(parseHtmlArticleLinks(await fetch(seed), seed));
    } catch {
      // Topic HTML pages are supplementary; keep whatever sitemap/API/RSS found.
    }
  }

  return urls;
}

const technologyreview: Provider = {
  key: "technologyreview",
  name: "MIT Technology Review",
  hostnames: ["technologyreview.com", "www.technologyreview.com"],
  seeds: TECHNOLOGY_REVIEW_SEEDS,
  articleUrlPattern: TECHNOLOGY_REVIEW_ARTICLE_URL_RE,
  articleUrlFilter: (url) => excludes(url, TECHNOLOGY_REVIEW_EXCLUDED_URL_FRAGMENTS),
  defaultCategory: "tech",
  categories: ["tech", "science", "health", "environment", "business", "culture", "politics"],
  // Long-form magazine: everything it publishes is substantive reading practice
  // — even globally-"medium" tech is in-depth here.
  readingCategories: ["tech", "science", "health", "environment", "business", "culture", "politics"],
  cleanup: {
    dropClassKeywords: [
      "deepDive",
      "deepDiveItem",
      "stayConnected",
      "newsletter",
      "recirc",
      "image-credit",
    ],
    dropTextKeywords: [
      "the checkup, our weekly biotech newsletter",
      "the checkup, mit technology review",
      "this story originally appeared in the algorithm",
      "our weekly newsletter on ai",
      "weekly biotech newsletter",
      "sign up to receive it in your inbox",
      "trouble saving your preferences",
    ],
  },
  quality: {
    digestListicleTitlePrefixes: ["the download:"],
  },
  categoryFor: (url, section) =>
    lookupSection(url, section, [
      [/biotechnology.?(&|and).?health|biotechnology|\bhealth\b|medicine/, "health"],
      [/climate.?change.?(&|and).?energy|climate|\benergy\b|environment/, "environment"],
      [/artificial.?intelligence|computing|\bai\b|software|robotic|technology|digital/, "tech"],
      [/space|astronom|physics|\bscience\b/, "science"],
      [/business|econom/, "business"],
      [/culture/, "culture"],
      [/\bpolicy\b|politic/, "politics"],
    ]),
  /**
   * Discovers the archive from every stable public source we have found:
   * robots-advertised sitemaps, the nested Jetpack sitemap tree, WordPress REST
   * posts API, RSS/topic feeds, and topic-page HTML links. Discovery still
   * validates pattern/filter/robots after this extractor returns candidates.
   */
  urlExtractor: technologyReviewUrlExtractor,
};

export default technologyreview;
