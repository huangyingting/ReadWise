import type { Provider } from "@/lib/scraper/types";
import { categoryFromFirstSegment, excludes } from "./shared";

const nbc: Provider = {
  key: "nbc",
  name: "NBC News",
  hostnames: ["nbcnews.com", "www.nbcnews.com"],
  seeds: [
    "https://www.nbcnews.com/world",
    "https://www.nbcnews.com/politics",
    "https://www.nbcnews.com/health",
    "https://www.nbcnews.com/science",
    "https://www.nbcnews.com/business",
  ],
  // NBC article slugs end with an "-rcnaNNNNN" id.
  articleUrlPattern: /\/[a-z0-9-]+-rcna\d+/i,
  articleUrlFilter: (url) =>
    excludes(url, ["/live-blog/", "/video/", "/nbc-news-now-live-audio", "select/shopping"]),
  defaultCategory: "world",
  categories: ["world", "politics", "business", "health", "science", "tech"],
  categoryFor: categoryFromFirstSegment,
  cleanup: {
    dropSelectors: ["video", "iframe", "aside"],
    dropClassKeywords: [
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
    ],
  },
};

export default nbc;
