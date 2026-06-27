import type { Provider } from "@/lib/scraper/types";
import { categoryFromFirstSegment, excludes } from "./shared";

const huffpost: Provider = {
  key: "huffpost",
  name: "HuffPost",
  hostnames: ["huffpost.com", "www.huffpost.com"],
  seeds: [
    "https://www.huffpost.com/news/world-news",
    "https://www.huffpost.com/news/politics",
    "https://www.huffpost.com/life/wellness",
    "https://www.huffpost.com/entertainment",
    "https://www.huffpost.com/news/business",
  ],
  articleUrlPattern: /\/entry\//i,
  articleUrlFilter: (url) => excludes(url, ["/video/", "/voices/", "/section/"]),
  defaultCategory: "world",
  categories: ["politics", "business", "entertainment", "world", "tech", "health"],
  categoryFor: categoryFromFirstSegment,
  cleanup: {
    dropSelectors: ["video", "iframe"],
    dropClassKeywords: ["related", "social", "newsletter", "promo", "advertisement", "comment"],
  },
};

export default huffpost;
