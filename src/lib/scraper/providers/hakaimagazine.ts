import type { Provider, UrlExtractorContext } from "@/lib/scraper/types";
import {
  collectSitemapUrls,
  COMMON_READING_SOURCE_CLEANUP,
  categoryFromRules,
  excludes,
  isPath,
} from "./shared";

const HAKAI_SITEMAPS = [
  "https://hakaimagazine.com/sitemap-posttype-custom_features.xml",
  "https://hakaimagazine.com/sitemap-posttype-custom_profile.xml",
] as const;

const HAKAI_CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/animals?|wildlife|whales?|fish|salmon|birds?|corals?|tortoises?|species/, "animals"],
  [/ocean|climate|coast|conservation|ecosystem|habitat|pollution|sea|marine/, "environment"],
  [/science|research|archaeolog|geolog|biology|ecology/, "science"],
  [/travel|islands?|canoe|journey|coastal|village|community/, "travel"],
  [/history|heritage|ancient|indigenous/, "history"],
  [/culture|food|language|story|books?/, "culture"],
];

async function hakaiMagazineUrlExtractor(ctx: UrlExtractorContext): Promise<string[]> {
  return collectSitemapUrls(HAKAI_SITEMAPS, ctx, (url) =>
    isPath(url, "hakaimagazine.com", /^\/(?:features|profiles)\/[a-z0-9][a-z0-9-]+\/?$/i),
  );
}

export const hakaiMagazine: Provider = {
  key: "hakaimagazine",
  name: "Hakai Magazine",
  hostnames: ["hakaimagazine.com", "www.hakaimagazine.com"],
  seeds: ["https://hakaimagazine.com/features/", "https://hakaimagazine.com/profiles/"],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?hakaimagazine\.com\/(?:features|profiles)\/[a-z0-9][a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, ["/wp-content/", "/author/", "/category/", "/tag/", "/newsletter/"]),
  defaultCategory: "environment",
  categories: ["environment", "animals", "travel", "science", "history", "culture"],
  readingCategories: ["environment", "animals", "travel", "science", "history", "culture"],
  cleanup: COMMON_READING_SOURCE_CLEANUP,
  categoryFor: (url, section) => categoryFromRules(url, section, HAKAI_CATEGORY_RULES, "environment"),
  urlExtractor: hakaiMagazineUrlExtractor,
};

export default hakaiMagazine;
