import { CATEGORY_SLUGS } from "@/lib/categories";
import type { Provider } from "@/lib/scraper/types";

/**
 * Maps a free-form section/topic string (from a URL path or article metadata)
 * onto one of our canonical category slugs. Returns null when nothing matches.
 */
export function mapSectionToCategory(section: string | null): string | null {
  if (!section) return null;
  const s = section.toLowerCase();

  const rules: Array<[RegExp, string]> = [
    [/\b(world|global|international|asia|europe|africa|americas|middle.?east)/, "world"],
    [/\b(politic|election|congress|white.?house|government|policy)/, "politics"],
    [/\b(business|money|econom|market|finance|deal|compan|industr)/, "business"],
    [/\b(health|wellness|coronavirus|covid|medic|fitness|disease)/, "health"],
    [/\b(science|scien|environment|climate|space|nature|animal|wildlife|planet)/, "science"],
    [/\b(tech|gadget|software|hardware|\bai\b|artificial.?intelligence|internet|digital)/, "tech"],
    [/\b(sport|nfl|nba|mlb|soccer|football|olympic)/, "sports"],
    [/\b(culture|art|book|style|travel|food|histor|fashion|design)/, "culture"],
    [/\b(entertainment|celebrit|tv|television|movie|film|music|hollywood|gaming|game)/, "entertainment"],
  ];

  for (const [pattern, slug] of rules) {
    if (pattern.test(s) && CATEGORY_SLUGS.includes(slug)) {
      return slug;
    }
  }
  return null;
}

/** Picks the first non-empty path segment of a URL (e.g. "/health/foo" -> "health"). */
function firstSegment(url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  return segments[0] ?? null;
}

const categoryFromFirstSegment = (url: URL, section: string | null): string | null =>
  mapSectionToCategory(section) ?? mapSectionToCategory(firstSegment(url));

export const PROVIDERS: readonly Provider[] = [
  {
    key: "nbc",
    name: "NBC News",
    hostnames: ["nbcnews.com", "www.nbcnews.com"],
    seeds: [
      "https://www.nbcnews.com/world",
      "https://www.nbcnews.com/politics",
      "https://www.nbcnews.com/health",
      "https://www.nbcnews.com/science",
      "https://www.nbcnews.com/business",
    ],
    // NBC article slugs end with an "-rcnaNNNNN" id.
    articleUrlPattern: /\/[a-z0-9-]+-rcna\d+/i,
    defaultCategory: "world",
    categoryFor: categoryFromFirstSegment,
  },
  {
    key: "natgeo",
    name: "National Geographic",
    hostnames: ["nationalgeographic.com", "www.nationalgeographic.com"],
    seeds: [
      "https://www.nationalgeographic.com/science",
      "https://www.nationalgeographic.com/environment",
      "https://www.nationalgeographic.com/animals",
      "https://www.nationalgeographic.com/history",
      "https://www.nationalgeographic.com/travel",
    ],
    articleUrlPattern: /\/article\//i,
    defaultCategory: "science",
    categoryFor: categoryFromFirstSegment,
  },
  {
    key: "time",
    name: "Time",
    hostnames: ["time.com", "www.time.com"],
    seeds: [
      "https://time.com/",
      "https://time.com/section/world/",
      "https://time.com/section/politics/",
      "https://time.com/section/health/",
      "https://time.com/section/business/",
    ],
    // Time article URLs look like time.com/article/YYYY/MM/DD/slug/
    articleUrlPattern: /time\.com\/article\/\d{4}\/\d{2}\/\d{2}\//i,
    defaultCategory: "world",
    categoryFor: (url, section) =>
      mapSectionToCategory(section) ??
      mapSectionToCategory(url.pathname.replace(/\/article\/\d{4}\/\d{2}\/\d{2}\//, "/")),
  },
  {
    key: "huffpost",
    name: "HuffPost",
    hostnames: ["huffpost.com", "www.huffpost.com"],
    seeds: [
      "https://www.huffpost.com/news/world-news",
      "https://www.huffpost.com/news/politics",
      "https://www.huffpost.com/life/wellness",
      "https://www.huffpost.com/entertainment",
      "https://www.huffpost.com/news/business",
    ],
    articleUrlPattern: /\/entry\//i,
    defaultCategory: "world",
    categoryFor: categoryFromFirstSegment,
  },
];

export function getProvider(key: string): Provider | null {
  return PROVIDERS.find((p) => p.key === key.toLowerCase()) ?? null;
}

/** Finds the provider that owns a given URL by hostname match. */
export function providerForUrl(rawUrl: string): Provider | null {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  return (
    PROVIDERS.find((p) =>
      p.hostnames.some((h) => h.replace(/^www\./, "") === host),
    ) ?? null
  );
}
