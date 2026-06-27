import type { Provider } from "@/lib/scraper/types";
import { categoryFromRules, excludes } from "./shared";
import { parseRssUrls } from "@/lib/scraper/rss";

/**
 * BBC News RSS feeds keyed by ReadWise category slug. Where BBC doesn't have
 * a dedicated feed, the nearest thematic feed is used as a fallback.
 *
 * Feed index: https://www.bbc.co.uk/news/10628494
 */
export const BBC_RSS_FEEDS: Record<string, string> = {
  world:         "https://feeds.bbci.co.uk/news/world/rss.xml",
  politics:      "https://feeds.bbci.co.uk/news/politics/rss.xml",
  business:      "https://feeds.bbci.co.uk/news/business/rss.xml",
  health:        "https://feeds.bbci.co.uk/news/health/rss.xml",
  science:       "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
  tech:          "https://feeds.bbci.co.uk/news/technology/rss.xml",
  entertainment: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
  // culture & sports share related feeds
  culture:       "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
  sports:        "https://feeds.bbci.co.uk/sport/rss.xml",
};

export function isBbcNewsArticleUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const hasArticlePath =
    /\/news\/articles\/[a-z0-9]+/.test(lower) || /\/news\/[a-z0-9_-]+-\d{6,}/.test(lower);
  return (
    hasArticlePath &&
    excludes(lower, ["/live/", "/in_pictures", "/av/", "/topics/", "/correspondents/"])
  );
}

const bbc: Provider = {
  key: "bbc",
  name: "BBC News",
  hostnames: ["bbc.com", "www.bbc.com", "bbc.co.uk", "www.bbc.co.uk"],
  seeds: [
    "https://www.bbc.com/news/world",
    "https://www.bbc.com/news/technology",
    "https://www.bbc.com/news/business",
    "https://www.bbc.com/news/science_and_environment",
    "https://www.bbc.com/news/health",
    "https://www.bbc.com/news/entertainment_and_arts",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?bbc\.(?:com|co\.uk)\/news\/(?:articles\/[a-z0-9]+|[a-z0-9_-]+-\d{6,})(?:[/?#].*)?$/i,
  articleUrlFilter: isBbcNewsArticleUrl,
  defaultCategory: "world",
  categories: ["world", "politics", "business", "health", "science", "tech"],
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/world|global|international|us[-_]and[-_]canada/, "world"],
        [/politic|election|government/, "politics"],
        [/business|econom|market|money/, "business"],
        [/technology|innovation|tech|\bai\b/, "tech"],
        [/science|environment|climate/, "science"],
        [/health|medical/, "health"],
        [/entertainment|arts|culture/, "entertainment"],
        [/sport/, "sports"],
      ],
      "world",
    ),
  /**
   * Discovers article URLs from BBC News RSS feeds (one per category).
   * Falls back gracefully if individual feeds are unreachable.
   */
  urlExtractor: async ({ limit, fetch: fetchFn }) => {
    const urls: string[] = [];
    for (const feedUrl of Object.values(BBC_RSS_FEEDS)) {
      if (urls.length >= limit * 2) break;
      try {
        const xml = await fetchFn(feedUrl);
        urls.push(...parseRssUrls(xml));
      } catch {
        // graceful degradation — a single feed failure doesn't stop discovery
      }
    }
    return urls;
  },
};

export default bbc;
