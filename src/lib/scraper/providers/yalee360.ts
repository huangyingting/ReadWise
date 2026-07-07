import type { Provider, UrlExtractorContext } from "@/lib/scraper/types";
import {
  addUnique,
  candidateCap,
  COMMON_READING_SOURCE_CLEANUP,
  categoryFromRules,
  excludes,
  hrefsFromHtml,
  isPath,
  validUrl,
} from "./shared";

const YALE_FEATURES_ROOT = "https://e360.yale.edu/features";
const YALE_MAX_FEATURE_PAGES = 500;
const YALE_FEATURE_ARTICLE_PATH_PATTERN = /^\/features\/(?!p\d+\/?$)[a-z0-9][a-z0-9-]+\/?$/i;

const YALE_E360_CLEANUP = {
  ...COMMON_READING_SOURCE_CLEANUP,
  dropTextKeywords: [
    ...(COMMON_READING_SOURCE_CLEANUP.dropTextKeywords ?? []),
    "Yale Environment 360 receives grant funding from",
  ],
};

const YALE_CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/animals?|wildlife|whales?|birds?|species|biodiversity|fish|krill/, "animals"],
  [/science|research|study|biology|geology|chemistry|physics/, "science"],
  [/technology|battery|solar|grid|electric|carbon.?capture/, "tech"],
  [/business|econom|finance|market|industry/, "business"],
  [/health|disease|public.?health/, "health"],
  [/climate|environment|energy|forest|ocean|water|pollution|conservation|ecosystem|emissions?/, "environment"],
];

async function yaleE360UrlExtractor(ctx: UrlExtractorContext): Promise<string[]> {
  const cap = candidateCap(ctx.limit);
  const seen = new Set<string>();
  const urls: string[] = [];
  let consecutiveEmpty = 0;
  const maxPages = Number.isFinite(ctx.limit)
    ? Math.min(YALE_MAX_FEATURE_PAGES, Math.ceil(cap / 20) + 5)
    : YALE_MAX_FEATURE_PAGES;

  for (let page = 1; page <= maxPages; page++) {
    if (urls.length >= cap) break;
    const pageUrl = page === 1 ? YALE_FEATURES_ROOT : `${YALE_FEATURES_ROOT}/p${page}`;
    let html: string;
    try {
      html = await ctx.fetch(pageUrl);
    } catch {
      if (page === 1) return [];
      break;
    }
    const before = urls.length;
    for (const url of hrefsFromHtml(html, pageUrl)) {
      const articleUrl = normalizeYaleE360FeatureUrl(url);
      if (!articleUrl) continue;
      if (addUnique(seen, urls, articleUrl, cap)) break;
    }
    consecutiveEmpty = urls.length === before ? consecutiveEmpty + 1 : 0;
    if (consecutiveEmpty >= 2) break;
  }

  return urls;
}

function normalizeYaleE360FeatureUrl(url: string): string | null {
  const parsed = validUrl(url);
  if (!parsed) return null;
  if (!isPath(parsed.href, "e360.yale.edu", YALE_FEATURE_ARTICLE_PATH_PATTERN)) return null;
  return `https://e360.yale.edu${parsed.pathname.replace(/\/$/, "")}`;
}

export const yaleEnvironment360: Provider = {
  key: "yalee360",
  name: "Yale Environment 360",
  hostnames: ["e360.yale.edu"],
  seeds: [YALE_FEATURES_ROOT],
  articleUrlPattern: /^https:\/\/e360\.yale\.edu\/features\/[a-z0-9][a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    Boolean(normalizeYaleE360FeatureUrl(url)) &&
    excludes(url, ["/digest/", "/authors/", "/topics/", "/about/"]),
  defaultCategory: "environment",
  categories: ["environment", "science", "animals", "tech", "business", "health"],
  readingCategories: ["environment", "science", "animals", "tech", "business", "health"],
  cleanup: YALE_E360_CLEANUP,
  categoryFor: (url, section) => categoryFromRules(url, section, YALE_CATEGORY_RULES, "environment"),
  urlExtractor: yaleE360UrlExtractor,
};

export default yaleEnvironment360;
