import type { Provider, UrlExtractorContext } from "@/lib/scraper/types";
import {
  addUnique,
  candidateCap,
  COMMON_READING_SOURCE_CLEANUP,
  categoryFromRules,
  excludes,
  hrefsFromHtml,
  isPath,
} from "./shared";

const YALE_FEATURES_ROOT = "https://e360.yale.edu/features";
const YALE_MAX_FEATURE_PAGES = 500;

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
      if (!isPath(url, "e360.yale.edu", /^\/features\/[a-z0-9][a-z0-9-]+\/?$/i)) continue;
      if (addUnique(seen, urls, url, cap)) break;
    }
    consecutiveEmpty = urls.length === before ? consecutiveEmpty + 1 : 0;
    if (consecutiveEmpty >= 2) break;
  }

  return urls;
}

export const yaleEnvironment360: Provider = {
  key: "yalee360",
  name: "Yale Environment 360",
  hostnames: ["e360.yale.edu"],
  seeds: [YALE_FEATURES_ROOT],
  articleUrlPattern: /^https:\/\/e360\.yale\.edu\/features\/[a-z0-9][a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) => excludes(url, ["/digest/", "/authors/", "/topics/", "/about/"]),
  defaultCategory: "environment",
  categories: ["environment", "science", "animals", "tech", "business", "health"],
  readingCategories: ["environment", "science", "animals", "tech", "business", "health"],
  cleanup: COMMON_READING_SOURCE_CLEANUP,
  categoryFor: (url, section) => categoryFromRules(url, section, YALE_CATEGORY_RULES, "environment"),
  urlExtractor: yaleE360UrlExtractor,
};

export default yaleEnvironment360;
