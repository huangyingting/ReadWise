import type { Provider, UrlExtractorContext } from "@/lib/scraper/types";
import { parseRssUrls } from "@/lib/scraper/rss";
import { categoryFromRules, excludes } from "./shared";

const NOEMA_SITEMAP_INDEX_URL = "https://www.noemamag.com/sitemap_index.xml";
const NOEMA_MAX_RSS_PAGES = 500;
const NOEMA_MAX_TOPIC_PAGES = 500;
const NOEMA_EMPTY_TOPIC_PAGE_LIMIT = 2;

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

function noemaTopicPageUrl(seed: string, page: number): string {
  if (page <= 1) return seed;
  const url = new URL(seed);
  url.searchParams.set("current_page", String(page));
  return url.href;
}

function candidateCap(limit: number): number {
  return Number.isFinite(limit) ? Math.max(limit * 2, limit) : Number.POSITIVE_INFINITY;
}

function normalizeDiscoveredUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function parseHtmlLinks(html: string, baseUrl: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const url = normalizeDiscoveredUrl(match[1] ?? "", baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push(url);
  }
  return links;
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

  for (const seed of noema.seeds) {
    if (!hasCapacity()) break;
    let consecutiveEmptyPages = 0;
    for (let page = 1; page <= NOEMA_MAX_TOPIC_PAGES && hasCapacity(); page++) {
      const pageUrl = noemaTopicPageUrl(seed, page);
      let topicUrls: string[];
      try {
        topicUrls = parseHtmlLinks(await fetch(pageUrl), pageUrl);
      } catch {
        break;
      }

      const added = add(topicUrls);
      if (added === 0) {
        consecutiveEmptyPages++;
        if (consecutiveEmptyPages >= NOEMA_EMPTY_TOPIC_PAGE_LIMIT) break;
      } else {
        consecutiveEmptyPages = 0;
      }
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
      "/privacy",
      "/subscribe",
      "/terms",
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
   * Discovers Noema's long-form article URLs from Yoast article sitemaps,
   * augments them with Noema's paginated RSS feed, then crawls the topic archive
   * pages (`?current_page=N`) as a final coverage check for older topic listings.
   * This provider-specific extractor keeps discovery network-testable through
   * the injected fetch and still lets discovery enforce pattern/filter/robots.
   */
  urlExtractor: noemaUrlExtractor,
};

export default noema;
