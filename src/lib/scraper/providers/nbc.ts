import type { Provider } from "@/lib/scraper/types";
import { categoryFromFirstSegment, excludes } from "./shared";

const HOSTNAMES = ["nbcnews.com", "www.nbcnews.com"];
const SEEDS = [
  "https://www.nbcnews.com/world",
  "https://www.nbcnews.com/politics",
  "https://www.nbcnews.com/health",
  "https://www.nbcnews.com/science",
  "https://www.nbcnews.com/business",
];
const EXCLUDED_ARTICLE_PATHS = [
  "/live-blog/",
  "/video/",
  "/nbc-news-now-live-audio",
  "select/shopping",
];
const CATEGORIES = ["world", "politics", "business", "health", "science", "tech"];
const DROP_SELECTORS = ["video", "iframe", "aside"];
const DROP_CLASS_KEYWORDS = [
  "related",
  "social-share",
  "newsletter",
  "promo",
  "advertisement",
  "byline-thumbnail",
  "author-thumbnail",
  "author-image",
  "expanded-byline-contributors",
  "articleBylineContainer",
];

function isNbcArticleUrl(url: string): boolean {
  return excludes(url, EXCLUDED_ARTICLE_PATHS);
}

const nbc: Provider = {
  key: "nbc",
  name: "NBC News",
  hostnames: HOSTNAMES,
  seeds: SEEDS,
  // NBC article slugs end with an "-rcnaNNNNN" id.
  articleUrlPattern: /\/[a-z0-9-]+-rcna\d+/i,
  articleUrlFilter: isNbcArticleUrl,
  defaultCategory: "world",
  categories: CATEGORIES,
  categoryFor: categoryFromFirstSegment,
  cleanup: {
    dropSelectors: DROP_SELECTORS,
    dropClassKeywords: DROP_CLASS_KEYWORDS,
  },
};

export default nbc;
