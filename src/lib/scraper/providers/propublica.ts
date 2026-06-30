import type { Provider, UrlExtractorContext } from "@/lib/scraper/types";
import { excludes, lookupSection, parseSitemapLocs } from "./shared";

const PROPUBLICA_SITEMAP_INDEX = "https://www.propublica.org/sitemap.xml";

function sitemapDate(url: string): string {
  try {
    const parsed = new URL(url);
    const yyyy = parsed.searchParams.get("yyyy") ?? "";
    const mm = parsed.searchParams.get("mm") ?? "";
    const dd = parsed.searchParams.get("dd") ?? "";
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return "";
  }
}

function isDailySitemap(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.replace(/^www\./, "") === "propublica.org" &&
      parsed.pathname === "/sitemap.xml" &&
      parsed.searchParams.has("yyyy") &&
      parsed.searchParams.has("mm") &&
      parsed.searchParams.has("dd")
    );
  } catch {
    return false;
  }
}

async function propublicaUrlExtractor({ limit, fetch }: UrlExtractorContext): Promise<string[]> {
  const cap = Number.isFinite(limit) ? Math.max(limit * 2, limit) : Number.POSITIVE_INFINITY;
  const seen = new Set<string>();
  const urls: string[] = [];

  let dailySitemaps: string[];
  try {
    dailySitemaps = parseSitemapLocs(await fetch(PROPUBLICA_SITEMAP_INDEX))
      .filter(isDailySitemap)
      .sort((a, b) => sitemapDate(b).localeCompare(sitemapDate(a)));
  } catch {
    return [];
  }

  for (const sitemapUrl of dailySitemaps) {
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

  return urls;
}

const propublica: Provider = {
  key: "propublica",
  name: "ProPublica",
  hostnames: ["propublica.org", "www.propublica.org"],
  seeds: [
    "https://www.propublica.org/topics/politics",
    "https://www.propublica.org/topics/criminal-justice",
    "https://www.propublica.org/topics/business",
    "https://www.propublica.org/topics/health-care",
    "https://www.propublica.org/topics/environment",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?propublica\.org\/article\/[a-z0-9][a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/donate",
      "/events/",
      "/podcasts/",
      "/series/",
      "/topics/",
      "/newsletters/",
      "/about",
      "/jobs",
      "/people/",
      "/tips/",
    ]),
  defaultCategory: "politics",
  categories: ["politics", "business", "world", "health", "environment", "tech", "culture"],
  readingCategories: ["politics", "business", "world", "health", "environment", "tech", "culture"],
  cleanup: {
    dropClassKeywords: [
      "donate",
      "newsletter",
      "recirc",
      "related",
      "series-nav",
      "share",
      "promo",
    ],
    dropTextKeywords: [
      "republish this story",
      "propublica is a nonprofit newsroom",
      "sign up for dispatches",
      "get our investigations delivered",
    ],
  },
  categoryFor: (url, section) =>
    lookupSection(
      url,
      section,
      [
        [/health|health.?care|hospital|medicine|medicaid|medicare|doctor|covid/, "health"],
        [/environment|climate|pollution|water|oil|gas|chemical|epa/, "environment"],
        [/business|econom|finance|tax|irs|bank|insurance|housing|workplace|corporat/, "business"],
        [/technology|tech|algorithm|\bai\b|data|surveillance|privacy|cyber/, "tech"],
        [/immigration|world|international|foreign|border|migrant|asylum/, "world"],
        [/education|school|university|culture|religion|child welfare/, "culture"],
        [/national|politic|trump|congress|election|police|justice|court|prison|crime|doj|death.?penalty|civil.?rights|government/, "politics"],
      ],
    ) ?? "politics",
  /**
   * ProPublica's root sitemap is an index of day-level sitemaps. Iterating
   * those newest-first gives broad archive coverage while keeping discovery
   * deterministic and avoiding topic/series chrome pages.
   */
  urlExtractor: propublicaUrlExtractor,
};

export default propublica;
