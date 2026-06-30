import type { ExtractorFetch, Provider } from "@/lib/scraper/types";
import { categoryFromRules, excludes } from "./shared";

const NATGEO_SITEMAP_INDEX_URL = "https://www.nationalgeographic.com/sitemaps/sitemap.xml";
const NATGEO_MAX_HUBMORE_PAGES = 20;
const NATGEO_EXCLUDED_ARTICLE_FRAGMENTS = [
  "/paid-content-",
  "/newsletters/",
  "/pages/article/masthead",
  "/search",
  "/subscribe",
  "/privacy",
  "/terms",
] as const;
const NATGEO_NON_EDITORIAL_SECTIONS = new Set([
  "books",
  "contests",
  "impact",
  "lifestyle",
  "maps",
  "podcasts",
]);

const NATGEO_SEEDS = [
  "https://www.nationalgeographic.com/pages/topic/latest-stories",
  "https://www.nationalgeographic.com/science",
  "https://www.nationalgeographic.com/environment",
  "https://www.nationalgeographic.com/animals",
  "https://www.nationalgeographic.com/history",
  "https://www.nationalgeographic.com/travel",
  "https://www.nationalgeographic.com/culture",
  "https://www.nationalgeographic.com/health",
  "https://www.nationalgeographic.com/photography",
  "https://www.nationalgeographic.com/adventure",
  "https://www.nationalgeographic.com/family",
  "https://www.nationalgeographic.com/books",
] as const;

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function decodeHtmlAttribute(value: string): string {
  return decodeXmlText(value)
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function normalizeDiscoveredUrl(raw: string, baseUrl?: string): string | null {
  try {
    const url = new URL(decodeHtmlAttribute(raw), baseUrl);
    url.hash = "";
    url.search = "";
    return url.href;
  } catch {
    return null;
  }
}

function isArticleCandidate(url: string): boolean {
  try {
    return new URL(url).pathname.split("/").includes("article");
  } catch {
    return false;
  }
}

function isLegacyTravelBlogUrl(url: URL): boolean {
  const parts = url.pathname.split("/").filter(Boolean);
  const slug = parts.at(-1) ?? "";
  return parts[0] === "travel" && parts[1] === "article" && slug.includes("_");
}

function isLikelyFormalNatGeoArticle(url: string): boolean {
  if (!excludes(url, NATGEO_EXCLUDED_ARTICLE_FRAGMENTS)) return false;
  try {
    const parsed = new URL(url);
    const firstSegment = parsed.pathname.split("/").filter(Boolean)[0];
    if (firstSegment && NATGEO_NON_EDITORIAL_SECTIONS.has(firstSegment)) return false;
    if (isLegacyTravelBlogUrl(parsed)) return false;
    return true;
  } catch {
    return false;
  }
}

function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => decodeXmlText(match[1]?.trim() ?? ""))
    .filter(Boolean);
}

function parseHtmlArticleLinks(html: string, baseUrl: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const url = normalizeDiscoveredUrl(match[1] ?? "", baseUrl);
    if (!url || !isArticleCandidate(url) || seen.has(url)) continue;
    seen.add(url);
    links.push(url);
  }
  return links;
}

function parseHubmoreUrls(html: string, baseUrl: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*\?hubmore[^"']*)["']/gi)) {
    try {
      const url = new URL(decodeHtmlAttribute(match[1] ?? ""), baseUrl);
      if (url.searchParams.get("hubmore") === null) continue;
      url.searchParams.set("page", "1");
      const href = url.href;
      if (seen.has(href)) continue;
      seen.add(href);
      urls.push(href);
    } catch {
      continue;
    }
  }
  return urls;
}

function hubmorePageUrl(templateUrl: string, page: number): string {
  const url = new URL(templateUrl);
  url.searchParams.set("page", String(page));
  return url.href;
}

function candidateCap(limit: number): number {
  return Number.isFinite(limit) ? Math.max(limit * 2, limit) : Number.POSITIVE_INFINITY;
}

async function collectHubmoreUrls(
  urls: string[],
  seen: Set<string>,
  fetch: ExtractorFetch,
  cap: number,
): Promise<void> {
  const add = (candidates: readonly string[]) => {
    let added = 0;
    for (const candidate of candidates) {
      if (urls.length >= cap) break;
      const url = normalizeDiscoveredUrl(candidate);
      if (!url || !isArticleCandidate(url) || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      added++;
    }
    return added;
  };

  for (const seed of NATGEO_SEEDS) {
    if (urls.length >= cap) break;
    let html: string;
    try {
      html = await fetch(seed);
    } catch {
      continue;
    }

    add(parseHtmlArticleLinks(html, seed));

    for (const hubmoreUrl of parseHubmoreUrls(html, seed)) {
      if (urls.length >= cap) break;
      let consecutiveEmptyPages = 0;
      for (let page = 1; page <= NATGEO_MAX_HUBMORE_PAGES && urls.length < cap; page++) {
        const pageUrl = hubmorePageUrl(hubmoreUrl, page);
        let pageHtml: string;
        try {
          pageHtml = await fetch(pageUrl);
        } catch {
          break;
        }

        const added = add(parseHtmlArticleLinks(pageHtml, pageUrl));
        if (added === 0) {
          consecutiveEmptyPages++;
          if (consecutiveEmptyPages >= 2) break;
        } else {
          consecutiveEmptyPages = 0;
        }
      }
    }
  }
}

async function collectSitemapUrls(
  urls: string[],
  seen: Set<string>,
  fetch: ExtractorFetch,
  cap: number,
): Promise<void> {
  let childSitemaps: string[];
  try {
    childSitemaps = parseSitemapLocs(await fetch(NATGEO_SITEMAP_INDEX_URL));
  } catch {
    return;
  }

  for (const sitemapUrl of childSitemaps) {
    if (urls.length >= cap) break;
    let locs: string[];
    try {
      locs = parseSitemapLocs(await fetch(sitemapUrl));
    } catch {
      continue;
    }

    for (const raw of locs) {
      if (urls.length >= cap) break;
      const url = normalizeDiscoveredUrl(raw);
      if (!url || !isArticleCandidate(url) || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }
}

async function natgeoUrlExtractor({
  limit,
  fetch,
}: Parameters<NonNullable<Provider["urlExtractor"]>>[0]): Promise<string[]> {
  const cap = candidateCap(limit);
  const seen = new Set<string>();
  const urls: string[] = [];

  await collectHubmoreUrls(urls, seen, fetch, cap);
  if (urls.length < cap) {
    await collectSitemapUrls(urls, seen, fetch, cap);
  }

  return urls;
}

const natgeo: Provider = {
  key: "natgeo",
  name: "National Geographic",
  hostnames: ["nationalgeographic.com", "www.nationalgeographic.com"],
  seeds: [...NATGEO_SEEDS],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?nationalgeographic\.com\/(?:[a-z0-9._%+-]+\/)*article\/[a-z0-9._%+-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: isLikelyFormalNatGeoArticle,
  defaultCategory: "science",
  categories: ["environment", "animals", "science", "history", "travel", "culture", "health"],
  // Long-form magazine: everything it publishes is substantive reading practice.
  readingCategories: ["environment", "animals", "science", "history", "travel", "culture", "health"],
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/health|wellness|medicine|disease|diet|sleep|fitness/, "health"],
        [/animals?|wildlife|birds|mammals|reptiles|fish|pets?/, "animals"],
        [/environment|climate|conservation|nature|planet|ocean|earth/, "environment"],
        [/history|archaeology|ancient|heritage|history-magazine/, "history"],
        [/travel|adventure|destination|national-parks|best-of-the-world/, "travel"],
        [/culture|photography|family|books|magazine|nat-geo-33/, "culture"],
        [/science|space|cosmos|physics|biology|genetics|astronomy/, "science"],
      ],
      "science",
    ),
  urlExtractor: natgeoUrlExtractor,
  cleanup: {
    dropSelectors: ["video", "iframe", "aside"],
    dropClassKeywords: ["related", "social", "newsletter", "promo"],
  },
};

export default natgeo;
