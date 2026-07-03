import type { Provider } from "@/lib/scraper/types";
import { mapSectionToCategory, excludes } from "./shared";

const HOSTNAMES = ["time.com", "www.time.com"];
const SEEDS = [
  "https://time.com/",
  "https://time.com/section/world/",
  "https://time.com/section/politics/",
  "https://time.com/section/health/",
  "https://time.com/section/business/",
];
const EXCLUDED_ARTICLE_PATHS = ["/collection", "/tag/", "/author/"];
const CATEGORIES = [
  "world",
  "politics",
  "business",
  "health",
  "science",
  "tech",
  "entertainment",
  "sports",
  "ideas",
  "environment",
];
const DROP_SELECTORS = ["video", "iframe"];
const DROP_CLASS_KEYWORDS = [
  "social-share",
  "share-tools",
  "newsletter-signup",
  "related-articles",
  "author-bio",
  "subscribe-prompt",
  "embed-wrapper",
  "video-embed",
];
const DATED_ARTICLE_PATH_PREFIX = /\/article\/\d{4}\/\d{2}\/\d{2}\//;

function isTimeArticleUrl(url: string): boolean {
  return excludes(url, EXCLUDED_ARTICLE_PATHS);
}

function timeCategoryFor(url: URL, section: string | null): string | null {
  return (
    mapSectionToCategory(section) ??
    mapSectionToCategory(url.pathname.replace(DATED_ARTICLE_PATH_PREFIX, "/"))
  );
}

const time: Provider = {
  key: "time",
  name: "Time",
  hostnames: HOSTNAMES,
  seeds: SEEDS,
  // Time article URLs have used both /article/YYYY/MM/DD/slug/ and /NNNNNNN/slug/ formats.
  articleUrlPattern: /time\.com\/(?:article\/\d{4}\/\d{2}\/\d{2}\/|\d{7}\/[a-z0-9-]+\/?)/i,
  articleUrlFilter: isTimeArticleUrl,
  defaultCategory: "world",
  categories: CATEGORIES,
  categoryFor: timeCategoryFor,
  cleanup: {
    dropSelectors: DROP_SELECTORS,
    dropClassKeywords: DROP_CLASS_KEYWORDS,
  },
};

export default time;
