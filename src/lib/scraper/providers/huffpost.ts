import type { Provider } from "@/lib/scraper/types";
import { categoryFromFirstSegment, excludes } from "./shared";

const HOSTNAMES = ["huffpost.com", "www.huffpost.com"];
const SEEDS = [
  "https://www.huffpost.com/news/world-news",
  "https://www.huffpost.com/news/politics",
  "https://www.huffpost.com/life/wellness",
  "https://www.huffpost.com/entertainment",
  "https://www.huffpost.com/news/business",
];
const EXCLUDED_ARTICLE_PATHS = ["/video/", "/voices/", "/section/"];
const CATEGORIES = ["politics", "business", "entertainment", "world", "tech", "health"];
const DROP_SELECTORS = ["video", "iframe"];
const DROP_CLASS_KEYWORDS = [
  "related",
  "related-entries",
  "social",
  "share-tools",
  "newsletter",
  "promo",
  "advertisement",
  "comment",
  "author-card",
  "embed-asset",
  "js-entry-video",
];

function isHuffPostArticleUrl(url: string): boolean {
  return excludes(url, EXCLUDED_ARTICLE_PATHS);
}

const huffpost: Provider = {
  key: "huffpost",
  name: "HuffPost",
  hostnames: HOSTNAMES,
  seeds: SEEDS,
  articleUrlPattern: /\/entry\//i,
  articleUrlFilter: isHuffPostArticleUrl,
  defaultCategory: "world",
  categories: CATEGORIES,
  categoryFor: categoryFromFirstSegment,
  cleanup: {
    dropSelectors: DROP_SELECTORS,
    dropClassKeywords: DROP_CLASS_KEYWORDS,
  },
};

export default huffpost;
