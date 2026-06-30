import type { ExtractorFetch, Provider } from "@/lib/scraper/types";
import { categoryFromRules, excludes, rssUrlExtractor, sitemapUrlExtractor } from "./shared";
import { fetchNautilusUrls } from "@/lib/scraper/wp-api";

const nautilusContentSitemapExtractor = sitemapUrlExtractor(
  "https://nautil.us/sitemap-index-1.xml",
  {
    sitemapUrlFilter: (url) => /^https:\/\/(?:www\.)?nautil\.us\/sitemap-\d+\.xml$/i.test(url),
  },
);

const nautilusRssExtractor = rssUrlExtractor([
  "https://nautil.us/feed",
  ...Array.from({ length: 9 }, (_, i) => `https://nautil.us/feed/?paged=${i + 2}`),
]);

async function collectNautilusUrls(
  limit: number,
  fetch: ExtractorFetch,
): Promise<string[]> {
  const candidateCap = Math.max(limit * 2, limit);
  const seen = new Set<string>();
  const urls: string[] = [];
  const add = (candidates: string[]) => {
    for (const url of candidates) {
      if (urls.length >= candidateCap) break;
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  };

  add(await fetchNautilusUrls(limit, fetch));
  if (urls.length < candidateCap) {
    add(await nautilusContentSitemapExtractor({ limit, fetch }));
  }
  if (urls.length === 0) {
    add(await nautilusRssExtractor({ limit, fetch }));
  }

  return urls;
}

const nautilus: Provider = {
  key: "nautilus",
  name: "Nautilus",
  hostnames: ["nautil.us", "www.nautil.us"],
  seeds: [
    "https://nautil.us/art-science/",
    "https://nautil.us/biology-beyond/",
    "https://nautil.us/cosmos/",
    "https://nautil.us/culture/",
    "https://nautil.us/earth/",
    "https://nautil.us/life/",
    "https://nautil.us/mind/",
    "https://nautil.us/ocean/",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?nautil\.us\/(?:[a-z0-9_-]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9_-]|%[0-9a-f]{2})+)?\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/page/",
      "/category/",
      "/tag/",
      "/author/",
      "/about",
      "/contact",
      "/newsletter",
      "/join",
      "/shop",
      "/feed",
      "/wp-",
      "/concierge",
    ]),
  defaultCategory: "science",
  categories: ["science", "ideas", "environment", "health"],
  // Long-form magazine: everything it publishes is substantive reading practice.
  readingCategories: ["science", "ideas", "environment", "health"],
  cleanup: {
    dropClassKeywords: [
      "ArticleNewsletterBlock",
      "NewsletterBlock",
      "SiteHeader",
      "PopoutNav",
      "newsletter",
      "subscribe",
      "SubscribeBtn",
    ],
    dropFigcaptions: true,
  },
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/environment|earth|ocean|climate|ecolog/, "environment"],
        [/mind|consciousness|philosophy|idea/, "ideas"],
        [/health|medic|wellness/, "health"],
        [/culture/, "culture"],
        [/biology|cosmos|life|science/, "science"],
      ],
      "science",
    ),
  /**
   * Discovers article URLs from Nautilus' public content sitemap. The legacy
   * WordPress REST path is retained as a recency hint when available, and RSS
   * is only a final fallback. Discovery validates every candidate against
   * `articleUrlPattern` / `articleUrlFilter`.
   */
  urlExtractor: (ctx) => collectNautilusUrls(ctx.limit, ctx.fetch),
};

export default nautilus;
