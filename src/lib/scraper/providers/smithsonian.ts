import type { Provider } from "@/lib/scraper/types";
import { excludes, lookupSection } from "./shared";

const SMITHSONIAN_SITEMAP_INDEX = "https://www.smithsonianmag.com/sitemap.xml";
const SMITHSONIAN_CATEGORIES = [
  "science-nature",
  "history",
  "arts-culture",
  "travel",
  "innovation",
  "smart-news",
  "smithsonian-institution",
] as const;

export type SmithsonianDiscoveryOptions = {
  sinceYear?: number | null;
  excludeSections?: readonly string[];
  includeCategoryArchives?: boolean;
  categoryVisibleOnly?: boolean;
};

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => decodeXmlText(match[1]?.trim() ?? ""))
    .filter(Boolean);
}

function normalizeDiscoveredUrl(raw: string, base?: string): string | null {
  try {
    const url = new URL(raw, base);
    url.hash = "";
    url.search = "";
    return url.href;
  } catch {
    return null;
  }
}

function articleSitemapYear(url: string): number | null {
  const match = url.match(/\/sitemap-articles-(\d{4})-\d{2}\.xml$/i);
  return match?.[1] ? Number(match[1]) : null;
}

function sectionForUrl(url: string): string | null {
  try {
    const first = new URL(url).pathname.split("/").filter(Boolean)[0];
    return first ?? null;
  } catch {
    return null;
  }
}

function parseCategoryArticleLinks(html: string, baseUrl: string): string[] {
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

function parseMaxCategoryPage(html: string): number {
  const pages = [...html.matchAll(/[?&]page=(\d+)/gi)]
    .map((match) => Number(match[1]))
    .filter((page) => Number.isInteger(page) && page > 0);
  return Math.max(1, ...pages);
}

function smithsonianCategoryUrl(category: string, page = 1): string {
  const url = new URL(`https://www.smithsonianmag.com/category/${category}/`);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.href;
}

function isExcludedSection(url: string, excluded: Set<string>): boolean {
  const section = sectionForUrl(url);
  return !!section && excluded.has(section);
}

function shouldKeepSitemapUrl(
  url: string,
  year: number,
  options: SmithsonianDiscoveryOptions,
  excluded: Set<string>,
): boolean {
  if (options.sinceYear != null && year < options.sinceYear) return false;
  if (isExcludedSection(url, excluded)) return false;
  return true;
}

function shouldKeepCategoryUrl(
  url: string,
  sitemapYears: Map<string, number>,
  options: SmithsonianDiscoveryOptions,
  excluded: Set<string>,
): boolean {
  if (isExcludedSection(url, excluded)) return false;

  const sitemapYear = sitemapYears.get(url);
  if (options.categoryVisibleOnly && sitemapYear == null) return false;
  if (options.sinceYear != null) {
    return sitemapYear != null && sitemapYear >= options.sinceYear;
  }
  return true;
}

function addUrl(urls: string[], seen: Set<string>, url: string, candidateCap: number): void {
  if (urls.length >= candidateCap || seen.has(url)) return;
  seen.add(url);
  urls.push(url);
}

export function createSmithsonianUrlExtractor(
  options: SmithsonianDiscoveryOptions = {},
): Provider["urlExtractor"] {
  const excluded = new Set(
    (options.excludeSections ?? [])
      .map((section) => section.trim().toLowerCase())
      .filter(Boolean),
  );

  return async ({ limit, fetch }) => {
    const candidateCap = Number.isFinite(limit)
      ? Math.max(limit * 2, limit)
      : Number.POSITIVE_INFINITY;
    const urls: string[] = [];
    const seen = new Set<string>();
    const sitemapYears = new Map<string, number>();

    let sitemapLocs: string[];
    try {
      sitemapLocs = parseLocs(await fetch(SMITHSONIAN_SITEMAP_INDEX));
    } catch {
      sitemapLocs = [];
    }

    const articleSitemaps = sitemapLocs
      .map((url) => ({ url, year: articleSitemapYear(url) }))
      .filter((entry): entry is { url: string; year: number } => entry.year != null)
      .filter((entry) => options.sinceYear == null || entry.year >= options.sinceYear)
      .sort((a, b) => b.year - a.year || b.url.localeCompare(a.url));

    for (const sitemap of articleSitemaps) {
      if (urls.length >= candidateCap) break;
      let locs: string[];
      try {
        locs = parseLocs(await fetch(sitemap.url));
      } catch {
        continue;
      }

      for (const raw of locs) {
        if (urls.length >= candidateCap) break;
        const url = normalizeDiscoveredUrl(raw);
        if (!url) continue;
        sitemapYears.set(url, sitemap.year);
        if (!shouldKeepSitemapUrl(url, sitemap.year, options, excluded)) continue;
        addUrl(urls, seen, url, candidateCap);
      }
    }

    if (!options.includeCategoryArchives || urls.length >= candidateCap) {
      return urls;
    }

    for (const category of SMITHSONIAN_CATEGORIES) {
      if (urls.length >= candidateCap) break;
      let firstHtml: string;
      const firstUrl = smithsonianCategoryUrl(category);
      try {
        firstHtml = await fetch(firstUrl);
      } catch {
        continue;
      }
      const maxPage = parseMaxCategoryPage(firstHtml);
      const pageHtmls: Array<{ url: string; html: string }> = [
        { url: firstUrl, html: firstHtml },
      ];

      for (let page = 2; page <= maxPage; page++) {
        if (urls.length >= candidateCap) break;
        const pageUrl = smithsonianCategoryUrl(category, page);
        try {
          pageHtmls.push({ url: pageUrl, html: await fetch(pageUrl) });
        } catch {
          continue;
        }
      }

      for (const { url: baseUrl, html } of pageHtmls) {
        if (urls.length >= candidateCap) break;
        for (const link of parseCategoryArticleLinks(html, baseUrl)) {
          if (!shouldKeepCategoryUrl(link, sitemapYears, options, excluded)) continue;
          addUrl(urls, seen, link, candidateCap);
        }
      }
    }

    return urls;
  };
}

export function createSmithsonianProvider(
  options: SmithsonianDiscoveryOptions = {},
): Provider {
  return {
    key: "smithsonian",
    name: "Smithsonian Magazine",
    hostnames: ["smithsonianmag.com", "www.smithsonianmag.com"],
    seeds: [
      "https://www.smithsonianmag.com/category/science-nature/",
      "https://www.smithsonianmag.com/category/history/",
      "https://www.smithsonianmag.com/category/arts-culture/",
      "https://www.smithsonianmag.com/category/travel/",
      "https://www.smithsonianmag.com/category/innovation/",
      "https://www.smithsonianmag.com/category/smithsonian-institution/",
    ],
    urlExtractor: createSmithsonianUrlExtractor(options),
    paginateSeed: (seed, page) => {
      const url = new URL(seed);
      url.searchParams.set("page", String(page));
      return url.href;
    },
    maxSeedPages: 1121,
    articleUrlPattern:
      /^https:\/\/(?:www\.)?smithsonianmag\.com\/[a-z-]+\/[a-z0-9-]+-\d+\/?(?:[?#].*)?$/i,
    articleUrlFilter: (url) =>
      excludes(url, [
        "/category/",
        "/tag/",
        "/author/",
        "/videos/",
        "/photocontest/",
        "/search/",
        "/subscribe/",
        "/privacy/",
        "/terms/",
      ]),
    defaultCategory: "history",
    categories: ["history", "science", "culture", "travel", "tech"],
    // Long-form magazine: everything it publishes is substantive reading practice.
    readingCategories: ["history", "science", "culture", "travel", "tech"],
    cleanup: {
      dropLinkHrefKeywords: [
        "subscribe.smithsonianmag.com",
        "promo_name=",
        "article-banner-ad",
      ],
      dropTextKeywords: [
        "issue of smithsonian magazine",
        "smithsonian magazine participates in affiliate link advertising programs",
        "knowable magazine is an independent journalistic endeavor",
        "this article is from hakai magazine",
      ],
    },
    categoryFor: (url, section) =>
      lookupSection(url, section, [
        [/innovation/, "tech"],
        [/history|heritage|archaeolog|ancient/, "history"],
        [/travel|destination/, "travel"],
        [
          /science.?(&|and|-).?nature|science-nature|\bscience\b|\bnature\b|smart-news/,
          "science",
        ],
        [
          /arts.?(&|and|-).?culture|arts-culture|\barts\b|culture|smithsonian-institution/,
          "culture",
        ],
      ]),
  };
}

const smithsonian: Provider = createSmithsonianProvider();

export default smithsonian;
