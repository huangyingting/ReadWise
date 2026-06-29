import type { Provider } from "@/lib/scraper/types";
import { excludes, lookupSection, rssUrlExtractor } from "./shared";

const technologyreview: Provider = {
  key: "technologyreview",
  name: "MIT Technology Review",
  hostnames: ["technologyreview.com", "www.technologyreview.com"],
  seeds: [
    "https://www.technologyreview.com/topic/artificial-intelligence",
    "https://www.technologyreview.com/topic/biotechnology",
    "https://www.technologyreview.com/topic/climate-change",
    "https://www.technologyreview.com/topic/computing",
    "https://www.technologyreview.com/topic/business",
    "https://www.technologyreview.com/topic/culture",
    "https://www.technologyreview.com/topic/space",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?technologyreview\.com\/\d{4}\/\d{2}\/\d{2}\/\d+\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/author/",
      "/topic/",
      "/newsletter/",
      "/podcasts/",
      "/events/",
      "/lists/",
      "/subscribe",
      "/about",
      "/sitemap",
    ]),
  defaultCategory: "tech",
  categories: ["tech", "science", "health", "environment"],
  // Long-form magazine: everything it publishes is substantive reading practice
  // — even globally-"medium" tech is in-depth here.
  readingCategories: ["tech", "science", "health", "environment"],
  cleanup: {
    dropClassKeywords: [
      "deepDive",
      "deepDiveItem",
      "stayConnected",
      "newsletter",
      "recirc",
    ],
    dropTextKeywords: [
      "the checkup, our weekly biotech newsletter",
      "the checkup, mit technology review",
      "weekly biotech newsletter",
      "sign up to receive it in your inbox",
      "trouble saving your preferences",
    ],
  },
  quality: {
    digestListicleTitlePrefixes: ["the download:"],
  },
  categoryFor: (url, section) =>
    lookupSection(url, section, [
      [/biotechnology.?(&|and).?health|biotechnology|\bhealth\b|medicine/, "health"],
      [/climate.?change.?(&|and).?energy|climate|\benergy\b|environment/, "environment"],
      [/artificial.?intelligence|computing|\bai\b|software|robotic|technology|digital/, "tech"],
      [/space|astronom|physics|\bscience\b/, "science"],
      [/business|econom/, "business"],
      [/culture/, "culture"],
      [/\bpolicy\b|politic/, "politics"],
    ]),
  /**
   * Discovers article URLs from MIT Technology Review's RSS feed (seed-HTML
   * discovery matches 0 article URLs). Candidates are validated against
   * `articleUrlPattern` and `articleUrlFilter` by discovery.
   */
  urlExtractor: rssUrlExtractor(["https://www.technologyreview.com/feed/"]),
};

export default technologyreview;
