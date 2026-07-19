import type { Provider, UrlExtractorContext } from "@/lib/scraper/types";
import { categoryFromRules, excludes, parseSitemapLocs } from "./shared";

const THE_CONVERSATION_SITEMAP_INDEX = "https://theconversation.com/sitemap.xml";
const ENGLISH_EDITIONS = new Set(["au", "ca", "global", "nz", "uk", "us"]);

type ArchiveSitemap = { url: string; edition: string; year: number };

const THE_CONVERSATION_CATEGORIES = [
  "world",
  "politics",
  "business",
  "health",
  "science",
  "environment",
  "tech",
  "culture",
  "history",
  "ideas",
];

const THE_CONVERSATION_CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/climate|environment|emissions|carbon|wildfire|heatwave|flood|biodivers|conservation|ecosystem/, "environment"],
  [/health|medicine|disease|covid|mental.?health|dementia|hospital|doctor|vaccine/, "health"],
  [/science|physics|biology|chemistry|space|astronom|archaeolog|research|genetic|geophysic|earthquake/, "science"],
  [/\bai\b|artificial.?intelligence|technology|digital|data|cyber|robot|computing/, "tech"],
  [/econom|business|trade|market|finance|inflation|tax|tuition|debt|capitalism/, "business"],
  [/election|politic|government|supreme.?court|congress|democracy|trump|biden|immigration|policy|devolution/, "politics"],
  [/history|ancient|medieval|archaeolog|heritage|titanic|robin.?hood|christians/, "history"],
  [/culture|art|music|film|book|sport|football|world.?cup|education|university|religion|society/, "culture"],
  [/philosophy|ethic|idea|meaning|happiness|consciousness/, "ideas"],
  [/world|global|international|venezuela|haiti|ukraine|israel|iran|africa|asia|europe|china|russia|migrant|humanitarian|aid/, "world"],
];

function candidateCap(limit: number): number {
  return Number.isFinite(limit) ? Math.max(limit * 2, limit) : Number.POSITIVE_INFINITY;
}

function archiveInfo(url: string): ArchiveSitemap | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "theconversation.com") return null;
    const match = parsed.pathname.match(/^\/([^/]+)\/sitemap_archive_(\d{4})\.xml$/i);
    if (!match || !ENGLISH_EDITIONS.has(match[1])) return null;
    return { url, edition: match[1], year: Number(match[2]) };
  } catch {
    return null;
  }
  return null;
}

async function archiveSitemaps(fetch: UrlExtractorContext["fetch"]): Promise<ArchiveSitemap[]> {
  return parseSitemapLocs(await fetch(THE_CONVERSATION_SITEMAP_INDEX))
    .map(archiveInfo)
    .filter((entry): entry is ArchiveSitemap => entry !== null)
    .sort((a, b) => b.year - a.year || a.edition.localeCompare(b.edition));
}

async function theConversationUrlExtractor({
  limit,
  fetch,
}: UrlExtractorContext): Promise<string[]> {
  const cap = candidateCap(limit);
  const seen = new Set<string>();
  const urls: string[] = [];

  let sitemaps: ArchiveSitemap[];
  try {
    sitemaps = await archiveSitemaps(fetch);
  } catch {
    return [];
  }

  for (const sitemap of sitemaps) {
    if (urls.length >= cap) break;
    let locs: string[];
    try {
      locs = parseSitemapLocs(await fetch(sitemap.url));
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

const theconversation: Provider = {
  key: "theconversation",
  name: "The Conversation",
  hostnames: ["theconversation.com", "www.theconversation.com"],
  seeds: [
    "https://theconversation.com/us",
    "https://theconversation.com/uk",
    "https://theconversation.com/au",
    "https://theconversation.com/ca",
    "https://theconversation.com/nz",
    "https://theconversation.com/global",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?theconversation\.com\/[a-z0-9][a-z0-9-]+-\d+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/topics/",
      "/profiles/",
      "/institutions/",
      "/partners/",
      "/search",
      "/sign_in",
      "/sign_up",
      "/become-an-author",
      "/events/",
      "/podcasts/",
      "/videos/",
      "/republishing",
    ]),
  defaultCategory: "world",
  categories: THE_CONVERSATION_CATEGORIES,
  readingCategories: [...THE_CONVERSATION_CATEGORIES],
  cleanup: {
    dropClassKeywords: [
      "donate",
      "republish",
      "article-footer",
      "article-promo",
      "newsletter",
      "social",
      "topic-list",
    ],
    dropTextKeywords: [
      "republish this article",
      "the conversation is an independent",
      "want to write?",
      "write an article and join a growing community",
    ],
  },
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      THE_CONVERSATION_CATEGORY_RULES,
      "world",
    ),
  /**
   * Uses The Conversation's public edition/year archive sitemaps. The root
   * sitemap includes many localized editions; this extractor intentionally
   * keeps English editions only, newest year first, so discovery starts with
   * current English articles and avoids non-English noise.
   */
  urlExtractor: theConversationUrlExtractor,
  urlIdentity: {
    canonicalHost: "theconversation.com",
    hostnameAliases: { "www.theconversation.com": "theconversation.com" },
    trailingSlash: "strip",
    amp: { pathSuffixes: ["amp"] },
  },
};

export default theconversation;
