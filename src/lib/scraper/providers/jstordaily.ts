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
  cleanup: COMMON_READING_SOURCE_CLEANUP,
  categoryFor: (url, section) => categoryFromRules(url, section, JSTOR_CATEGORY_RULES, "history"),
  urlExtractor: jstorDailyUrlExtractor,
};

export default jstorDaily;
