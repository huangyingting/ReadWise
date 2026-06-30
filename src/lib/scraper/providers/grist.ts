import type { Provider, UrlExtractorContext } from "@/lib/scraper/types";
import { categoryFromRules, excludes, parseSitemapLocs, rssUrlExtractor } from "./shared";

const GRIST_SITEMAP_INDEX = "https://grist.org/sitemap_index.xml";
const gristRssFallback = rssUrlExtractor(["https://grist.org/feed/"]);

function postSitemapNumber(url: string): number {
  const match = url.match(/\/post-sitemap(\d*)\.xml$/i);
  if (!match) return -1;
  return match[1] ? Number(match[1]) : 1;
}

function isPostSitemap(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "grist.org" && /^\/post-sitemap\d*\.xml$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function gristUrlExtractor({ limit, fetch }: UrlExtractorContext): Promise<string[]> {
  const cap = Number.isFinite(limit) ? Math.max(limit * 2, limit) : Number.POSITIVE_INFINITY;
  const seen = new Set<string>();
  const urls: string[] = [];

  try {
    const postSitemaps = parseSitemapLocs(await fetch(GRIST_SITEMAP_INDEX))
      .filter(isPostSitemap)
      .sort((a, b) => postSitemapNumber(b) - postSitemapNumber(a));

    for (const sitemapUrl of postSitemaps) {
      if (urls.length >= cap) break;
      let locs: string[];
      try {
        locs = parseSitemapLocs(await fetch(sitemapUrl));
      } catch {
        continue;
      }
      for (const url of locs) {
        if (urls.length >= cap) break;
        if (seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
    }
  } catch {
    return gristRssFallback({ limit, fetch });
  }

  return urls.length > 0 ? urls : gristRssFallback({ limit, fetch });
}

const grist: Provider = {
  key: "grist",
  name: "Grist",
  hostnames: ["grist.org", "www.grist.org"],
  seeds: [
    "https://grist.org/climate-energy/",
    "https://grist.org/politics/",
    "https://grist.org/accountability/",
    "https://grist.org/food-and-agriculture/",
    "https://grist.org/extreme-weather/",
  ],
  articleUrlPattern: /^https:\/\/(?:www\.)?grist\.org\/[a-z0-9-]+\/[a-z0-9][a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/about",
      "/author/",
      "/category/",
      "/events/",
      "/grist-50/",
      "/newsletter",
      "/page/",
      "/press/",
      "/sponsored",
      "/updates/",
      "/wp-content/",
    ]),
  defaultCategory: "environment",
  categories: ["environment", "politics", "business", "health", "science", "tech", "culture"],
  readingCategories: ["environment", "politics", "business", "health", "science", "tech", "culture"],
  cleanup: {
    dropClassKeywords: [
      "donate",
      "newsletter",
      "recirc",
      "related",
      "share",
      "support",
      "promo",
    ],
    dropTextKeywords: [
      "grist is a nonprofit",
      "support solutions-based climate news",
      "a version of this article originally appeared",
    ],
  },
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/health|disease|public.?health|heat.?stress|mental.?health/, "health"],
        [/science|research|study|scientist/, "science"],
        [/technology|tech|data.?center|grid|solar|wind|battery|electric|\bev\b|\bai\b/, "tech"],
        [/business|econom|finance|insurance|jobs|labor|industry|market/, "business"],
        [/politic|policy|justice|accountability|protest|green.?new.?deal|government|election|regulation/, "politics"],
        [/culture|food|fashion|books?|film|art|therapy/, "culture"],
        [/climate|energy|environment|extreme.?weather|heat|wildfire|flood|water|agriculture|conservation|pollution|carbon|emissions/, "environment"],
      ],
      "environment",
    ),
  /**
   * Uses Grist's Yoast post sitemaps, newest numbered sitemap first. This
   * prioritizes current substantive climate articles and leaves old short posts
   * to the existing post-extraction quality gate.
   */
  urlExtractor: gristUrlExtractor,
};

export default grist;
