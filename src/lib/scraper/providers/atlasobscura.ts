import type { Provider, UrlExtractorContext } from "@/lib/scraper/types";
import {
  addUnique,
  candidateCap,
  COMMON_READING_SOURCE_CLEANUP,
  categoryFromRules,
  excludes,
  isPath,
  parseSitemapLocs,
} from "./shared";

const ATLAS_SITEMAPS = [
  "https://www.atlasobscura.com/sitemaps/articles.xml.gz",
  "https://www.atlasobscura.com/sitemaps/gastro.xml.gz",
  "https://www.atlasobscura.com/sitemaps/lists.xml.gz",
] as const;

const ATLAS_DROP_CLASS_KEYWORDS = [
  ...COMMON_READING_SOURCE_CLEANUP.dropClassKeywords,
  "articlebody__interrupt-card",
  "article-gastro-interruptor",
  "articleheader",
  "stories-breadcrumb",
];

const ATLAS_DROP_TEXT_KEYWORDS = [
  ...COMMON_READING_SOURCE_CLEANUP.dropTextKeywords,
  "a version of this post originally appeared on",
  "every day we track down a video wonder",
  "every day, we track down a fleeting wonder",
  "illinois week on atlas obscura was created in partnership",
  "map monday highlights interesting and unusual cartographic pursuits",
  "naturecultures is a weekly column",
  "sign up here to explore illinois",
  ...Array.from({ length: 12 }, (_, index) => `update ${index + 1}/`),
  ...Array.from({ length: 12 }, (_, index) => `update, ${index + 1}/`),
  "we regret the error",
  "we regret the errors",
];

const ATLAS_CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/animals?|birds?|wildlife|creature|species|mummies|dinosaur|fossil/, "animals"],
  [/history|historic|ancient|archaeolog|medieval|heritage|museums?|archive|ruins?/, "history"],
  [/foods?|gastro|cuisine|restaurant|recipe|drink|culinary|kitchen/, "culture"],
  [/travel|journey|map|destination|island|city|country|world|roads?|hotel|tour/, "travel"],
  [/science|space|astronom|biology|geology|experiment|research/, "science"],
  [/environment|climate|nature|ocean|forest|conservation/, "environment"],
  [/art|books?|music|film|culture|festival|tradition|language/, "culture"],
];

async function atlasObscuraUrlExtractor(ctx: UrlExtractorContext): Promise<string[]> {
  const cap = candidateCap(ctx.limit);
  const seen = new Set<string>();
  const urls: string[] = [];
  const keepUrl = (url: string) =>
    isPath(url, "atlasobscura.com", /^\/(?:articles|foods|lists)\/[a-z0-9][a-z0-9-]+\/?$/i) &&
    !url.toLowerCase().includes("/articles/podcast-");

  for (const sitemapUrl of ATLAS_SITEMAPS) {
    if (urls.length >= cap) break;
    let locs: string[];
    try {
      locs = parseSitemapLocs(await ctx.fetch(sitemapUrl)).reverse();
    } catch {
      continue;
    }
    for (const url of locs) {
      if (!keepUrl(url)) continue;
      if (addUnique(seen, urls, url, cap)) break;
    }
  }

  return urls;
}

export const atlasObscura: Provider = {
  key: "atlasobscura",
  name: "Atlas Obscura",
  hostnames: ["atlasobscura.com", "www.atlasobscura.com"],
  seeds: ["https://www.atlasobscura.com/articles"],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?atlasobscura\.com\/(?:articles|foods|lists)\/[a-z0-9][a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, ["/articles/podcast-", "/places/", "/events/", "/experiences/", "/users/", "/latest/"]),
  defaultCategory: "travel",
  categories: ["travel", "history", "culture", "animals", "science", "environment"],
  readingCategories: ["travel", "history", "culture", "animals", "science", "environment"],
  cleanup: {
    ...COMMON_READING_SOURCE_CLEANUP,
    dropClassKeywords: ATLAS_DROP_CLASS_KEYWORDS,
    dropTextKeywords: ATLAS_DROP_TEXT_KEYWORDS,
    dropLinkHrefKeywords: ["enjoyillinois.com/tripideas/offbeat"],
    dropLinkHrefBlockKeywords: ["/newsletters/", "list-manage.com", "wildlife.atlasobscura.com"],
    dropEmptyImageOnlyFigures: true,
  },
  categoryFor: (url, section) => categoryFromRules(url, section, ATLAS_CATEGORY_RULES, "travel"),
  urlExtractor: atlasObscuraUrlExtractor,
};

export default atlasObscura;
