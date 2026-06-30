import type { Provider } from "@/lib/scraper/types";
import { excludes, lookupSection, parseSitemapLocs, rssUrlExtractor } from "./shared";

const TECHNOLOGY_REVIEW_SITEMAP_INDEX = "https://www.technologyreview.com/sitemap.xml";
const technologyReviewRssFallback = rssUrlExtractor(["https://www.technologyreview.com/feed/"]);

function sitemapNumber(url: string): number {
  const match = url.match(/\/sitemap-(\d+)\.xml$/i);
  return match?.[1] ? Number(match[1]) : 0;
}

function isContentSitemap(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.replace(/^www\./, "") === "technologyreview.com" &&
      /^\/sitemap-\d+\.xml$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

async function technologyReviewUrlExtractor({
  limit,
  fetch,
}: Parameters<NonNullable<Provider["urlExtractor"]>>[0]): Promise<string[]> {
  const cap = Number.isFinite(limit) ? Math.max(limit * 2, limit) : Number.POSITIVE_INFINITY;
  const seen = new Set<string>();
  const urls: string[] = [];
  const add = (candidates: readonly string[]) => {
    for (const url of candidates) {
      if (urls.length >= cap) break;
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  };

  try {
    const rootLocs = parseSitemapLocs(await fetch(TECHNOLOGY_REVIEW_SITEMAP_INDEX));
    const nestedIndexes = rootLocs.filter((url) => /\/sitemap-index-\d+\.xml$/i.test(url));
    const childSitemaps: string[] = [];

    for (const indexUrl of nestedIndexes) {
      if (urls.length >= cap) break;
      try {
        childSitemaps.push(...parseSitemapLocs(await fetch(indexUrl)).filter(isContentSitemap));
      } catch {
        // Keep the RSS fallback available if an index page is unavailable.
      }
    }

    childSitemaps.sort((a, b) => sitemapNumber(b) - sitemapNumber(a));
    for (const sitemapUrl of childSitemaps) {
      if (urls.length >= cap) break;
      try {
        add(parseSitemapLocs(await fetch(sitemapUrl)));
      } catch {
        // Continue with older/newer child sitemaps when one fetch fails.
      }
    }
  } catch {
    // RSS fallback below.
  }

  if (urls.length > 0) return urls;
  return technologyReviewRssFallback({ limit, fetch });
}

const technologyreview: Provider = {
  key: "technologyreview",
  name: "MIT Technology Review",
  hostnames: ["technologyreview.com", "www.technologyreview.com"],
  seeds: [
    "https://www.technologyreview.com/topic/artificial-intelligence",
    "https://www.technologyreview.com/topic/biotechnology",
    "https://www.technologyreview.com/topic/climate-change",
    "https://www.technologyreview.com/topic/computing",
    "https://www.technologyreview.com/topic/business",
    "https://www.technologyreview.com/topic/culture",
    "https://www.technologyreview.com/topic/space",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?technologyreview\.com\/\d{4}\/\d{2}\/\d{2}\/\d+\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
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
    ]),
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
   * Discovers the archive from MIT Technology Review's public nested sitemap
   * index, newest child sitemap first. Falls back to RSS when the sitemap is
   * unavailable. Discovery still validates pattern/filter/robots.
   */
  urlExtractor: technologyReviewUrlExtractor,
};

export default technologyreview;
