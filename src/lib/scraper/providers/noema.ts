import type { Provider, UrlExtractorContext } from "@/lib/scraper/types";
import { parseRssUrls } from "@/lib/scraper/rss";
import { categoryFromRules, excludes } from "./shared";

const NOEMA_SITEMAP_INDEX_URL = "https://www.noemamag.com/sitemap_index.xml";
const NOEMA_MAX_RSS_PAGES = 500;

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => decodeXmlText(match[1]?.trim() ?? ""))
    .filter(Boolean);
}

function isNoemaArticleSitemap(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return (
      hostname.replace(/^www\./, "") === "noemamag.com" &&
      /^\/wpm-article-sitemap\d*\.xml$/i.test(pathname)
    );
  } catch {
    return false;
  }
}

function noemaRssFeedUrl(page: number): string {
  return `https://www.noemamag.com/?feed=noemarss&paged=${page}`;
}

function candidateCap(limit: number): number {
  return Number.isFinite(limit) ? Math.max(limit * 2, limit) : Number.POSITIVE_INFINITY;
}

async function noemaUrlExtractor({ limit, fetch }: UrlExtractorContext): Promise<string[]> {
  const cap = candidateCap(limit);
  const seen = new Set<string>();
  const urls: string[] = [];

  const add = (candidates: readonly string[]): number => {
    let added = 0;
    for (const url of candidates) {
      if (urls.length >= cap) break;
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      added++;
    }
    return added;
  };

  const hasCapacity = () => urls.length < cap;

  try {
    const indexXml = await fetch(NOEMA_SITEMAP_INDEX_URL);
    const articleSitemaps = parseSitemapLocs(indexXml).filter(isNoemaArticleSitemap);
    for (const sitemapUrl of articleSitemaps) {
      if (!hasCapacity()) break;
      try {
        add(parseSitemapLocs(await fetch(sitemapUrl)));
      } catch {
        // Keep other Noema sources available if one child sitemap is blocked.
      }
    }
  } catch {
    // The RSS crawl below still gives Noema coverage if the sitemap is blocked.
  }

  let consecutiveEmptyPages = 0;
  for (let page = 1; page <= NOEMA_MAX_RSS_PAGES && hasCapacity(); page++) {
    let feedUrls: string[];
    try {
      feedUrls = parseRssUrls(await fetch(noemaRssFeedUrl(page)));
    } catch {
      break;
    }

    add(feedUrls);
    if (feedUrls.length === 0) {
      consecutiveEmptyPages++;
      if (consecutiveEmptyPages >= 2) break;
    } else {
      consecutiveEmptyPages = 0;
    }
  }

  return urls;
}

const noema: Provider = {
  key: "noema",
  name: "Noema Magazine",
  hostnames: ["noemamag.com", "www.noemamag.com"],
  seeds: [
    "https://www.noemamag.com/article-topic/technology-and-the-human/",
    "https://www.noemamag.com/article-topic/future-of-capitalism/",
    "https://www.noemamag.com/article-topic/philosophy-culture/",
    "https://www.noemamag.com/article-topic/climate-crisis/",
    "https://www.noemamag.com/article-topic/geopolitics-globalization/",
    "https://www.noemamag.com/article-topic/future-of-democracy/",
    "https://www.noemamag.com/article-topic/digital-society/",
  ],
  articleUrlPattern: /^https:\/\/(?:www\.)?noemamag\.com\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/article-topic/",
      "/article-type/",
      "/author/",
      "/tag/",
      "/about",
      "/contact",
      "/newsletter",
      "/masthead",
      "/careers",
      "/feed",
      "/wp-",
      "/articles-search",
    ]),
  defaultCategory: "ideas",
  categories: ["ideas", "politics", "culture", "tech", "science", "environment"],
  // Long-form magazine: everything it publishes is substantive reading practice
  // — even its globally-"low" politics is essay-length, evergreen analysis.
  readingCategories: ["ideas", "politics", "culture", "tech", "science", "environment"],
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/technology|digital|human/, "tech"],
        [/capitalism|business|econom/, "business"],
        [/climate|environment|science/, "science"],
        [/philosophy|idea|essay|consciousness/, "ideas"],
        [/geopolitics|globalization|democracy|politic/, "politics"],
        [/culture/, "culture"],
      ],
      "ideas",
    ),
  /**
   * Discovers Noema's long-form article URLs from the Yoast article sitemaps,
   * then augments them with Noema's paginated RSS feed until it is exhausted.
   * Seed HTML pages, WordPress REST, and GraphQL are blocked/unavailable; this
   * provider-specific extractor keeps discovery network-testable through the
   * injected fetch and still lets discovery enforce pattern/filter/robots rules.
   */
  urlExtractor: noemaUrlExtractor,
};

export default noema;
