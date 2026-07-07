import type { Provider, UrlExtractorContext } from "@/lib/scraper/types";
import {
  collectSitemapUrls,
  COMMON_READING_SOURCE_CLEANUP,
  categoryFromRules,
  excludes,
  isPath,
  parseSitemapLocs,
  validUrl,
} from "./shared";

const JSTOR_SITEMAP_INDEX = "https://daily.jstor.org/sitemap_index.xml";

const JSTOR_CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/history|ancient|medieval|archive|war|century|renaissance|victorian/, "history"],
  [/idea|philosoph|ethic|religion|belief|essay|society|political.?theory/, "ideas"],
  [/science|biology|medicine|disease|psycholog|technology|internet|ecology/, "science"],
  [/art|literature|books?|music|film|culture|food|language|folklore/, "culture"],
  [/business|econom|labor|work|finance|market|trade/, "business"],
  [/environment|climate|conservation|pollution|nature|ocean/, "environment"],
  [/travel|tourism|journey|migration/, "travel"],
];

const JSTOR_DAILY_RESEARCH_NOTE =
  "JSTOR is a digital library for scholars, researchers, and students. JSTOR Daily readers can access the original research behind our articles for free on JSTOR.";
const JSTOR_DAILY_ICON_NOTICE = "The icon indicates free access to the linked research on JSTOR.";

const JSTOR_DAILY_CLEANUP = {
  ...COMMON_READING_SOURCE_CLEANUP,
  dropClassKeywords: [
    ...COMMON_READING_SOURCE_CLEANUP.dropClassKeywords.filter(
      (keyword) => keyword !== "social" && keyword !== "share",
    ),
    "article-citations-container",
    "j-icon",
    "jstor-logo",
  ],
  dropTextKeywords: [
    ...(COMMON_READING_SOURCE_CLEANUP.dropTextKeywords ?? []),
    "jstor daily provides context for current events using scholarship found in jstor",
    "jstor is part of ithaka",
  ],
  dropTextExactKeywords: [JSTOR_DAILY_ICON_NOTICE, JSTOR_DAILY_RESEARCH_NOTE],
  dropLinkHrefBlockKeywords: ["collaborate-with-jstor"],
};

function postSitemapNumber(url: string): number {
  const match = url.match(/\/post-sitemap(\d*)\.xml$/i);
  if (!match) return Number.POSITIVE_INFINITY;
  return match[1] ? Number(match[1]) : 1;
}

async function jstorDailyUrlExtractor(ctx: UrlExtractorContext): Promise<string[]> {
  let childSitemaps: string[];
  try {
    childSitemaps = parseSitemapLocs(await ctx.fetch(JSTOR_SITEMAP_INDEX))
      .filter((url) => {
        const parsed = validUrl(url);
        return (
          parsed?.hostname === "daily.jstor.org" &&
          /^\/post-sitemap\d*\.xml$/i.test(parsed.pathname)
        );
      })
      .sort((a, b) => postSitemapNumber(a) - postSitemapNumber(b));
  } catch {
    return [];
  }

  return collectSitemapUrls(childSitemaps, ctx, (url) =>
    isPath(url, "daily.jstor.org", /^\/(?!archives\/?$)[a-z0-9][a-z0-9-]+\/?$/i),
  );
}

export const jstorDaily: Provider = {
  key: "jstordaily",
  name: "JSTOR Daily",
  hostnames: ["daily.jstor.org"],
  seeds: ["https://daily.jstor.org"],
  articleUrlPattern: /^https:\/\/daily\.jstor\.org\/[a-z0-9][a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, ["/archives", "/category/", "/columns/", "/newsletter", "/authors/"]),
  defaultCategory: "history",
  categories: ["history", "ideas", "culture", "science", "business", "environment", "travel"],
  readingCategories: ["history", "ideas", "culture", "science", "business", "environment", "travel"],
  cleanup: JSTOR_DAILY_CLEANUP,
  categoryFor: (url, section) => categoryFromRules(url, section, JSTOR_CATEGORY_RULES, "history"),
  urlExtractor: jstorDailyUrlExtractor,
};

export default jstorDaily;
