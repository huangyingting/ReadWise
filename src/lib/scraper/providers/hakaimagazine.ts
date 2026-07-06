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
  "https://hakaimagazine.com/sitemap-posttype-custom_news.xml",
  "https://hakaimagazine.com/sitemap-posttype-custom_visuals.xml",
  "https://hakaimagazine.com/sitemap-posttype-custom_quick.xml",
] as const;

const HAKAI_ARTICLE_PATH_PATTERN = /^\/(?:features|news|videos-visuals|article-short)\/[a-z0-9][a-z0-9-]+\/?$/i;

const HAKAI_DROP_CLASS_KEYWORDS = [
  ...COMMON_READING_SOURCE_CLEANUP.dropClassKeywords,
  "cite",
  "printonly",
  "relatedcontent",
  "singlebydatewords",
  "singlebyline",
  "social-sharing",
  "story-membership-campaign",
] as const;

const HAKAI_DROP_SELECTORS = ["video"] as const;

const HAKAI_DROP_TEXT_KEYWORDS = [
  "Read our follow-up story",
  "Reporting for this story was supported by",
  "The Hakai Institute and",
  "This article is also available in audio format",
  "This article is the first in a two-part series",
  "This article is the second in a two-part series",
  "Tula Foundation",
] as const;

const HAKAI_DROP_TEXT_EXACT_KEYWORDS = [
  "Article body copy",
  "Article footer and bottom matter",
  "Authored by",
  "Cite this Article:",
  "Wordcount",
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
    isPath(url, "hakaimagazine.com", HAKAI_ARTICLE_PATH_PATTERN),
  );
}

export const hakaiMagazine: Provider = {
  key: "hakaimagazine",
  name: "Hakai Magazine",
  hostnames: ["hakaimagazine.com", "www.hakaimagazine.com"],
  seeds: [
    "https://hakaimagazine.com/features/",
    "https://hakaimagazine.com/news/",
    "https://hakaimagazine.com/videos-visuals/",
    "https://hakaimagazine.com/article-short/",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?hakaimagazine\.com\/(?:features|news|videos-visuals|article-short)\/[a-z0-9][a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    isPath(url, "hakaimagazine.com", HAKAI_ARTICLE_PATH_PATTERN) &&
    excludes(url, ["/profiles/", "/wp-content/", "/author/", "/category/", "/tag/", "/newsletter/"]),
  defaultCategory: "environment",
  categories: ["environment", "animals", "travel", "science", "history", "culture"],
  readingCategories: ["environment", "animals", "travel", "science", "history", "culture"],
  cleanup: {
    ...COMMON_READING_SOURCE_CLEANUP,
    dropSelectors: [...HAKAI_DROP_SELECTORS],
    dropClassKeywords: [...HAKAI_DROP_CLASS_KEYWORDS],
    dropTextKeywords: [
      ...(COMMON_READING_SOURCE_CLEANUP.dropTextKeywords ?? []),
      ...HAKAI_DROP_TEXT_KEYWORDS,
    ],
    dropTextExactKeywords: [...HAKAI_DROP_TEXT_EXACT_KEYWORDS],
  },
  categoryFor: (url, section) => categoryFromRules(url, section, HAKAI_CATEGORY_RULES, "environment"),
  urlExtractor: hakaiMagazineUrlExtractor,
};

export default hakaiMagazine;
