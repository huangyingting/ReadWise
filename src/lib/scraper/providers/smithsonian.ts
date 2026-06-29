import type { Provider } from "@/lib/scraper/types";
import { excludes, lookupSection, sitemapUrlExtractor } from "./shared";

const smithsonian: Provider = {
  key: "smithsonian",
  name: "Smithsonian Magazine",
  hostnames: ["smithsonianmag.com", "www.smithsonianmag.com"],
  seeds: [
    "https://www.smithsonianmag.com/category/science-nature/",
    "https://www.smithsonianmag.com/category/history/",
    "https://www.smithsonianmag.com/category/arts-culture/",
    "https://www.smithsonianmag.com/category/travel/",
    "https://www.smithsonianmag.com/category/innovation/",
  ],
  urlExtractor: sitemapUrlExtractor(
    "https://www.smithsonianmag.com/sitemap.xml",
    {
      sitemapUrlFilter: (url) =>
        /\/sitemap-articles-\d{4}-\d{2}\.xml$/i.test(url),
    },
  ),
  paginateSeed: (seed, page) => {
    const url = new URL(seed);
    url.searchParams.set("page", String(page));
    return url.href;
  },
  maxSeedPages: 8,
  articleUrlPattern:
    /^https:\/\/(?:www\.)?smithsonianmag\.com\/[a-z-]+\/[a-z0-9-]+-\d+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/category/",
      "/tag/",
      "/author/",
      "/videos/",
      "/photocontest/",
      "/search/",
      "/subscribe/",
      "/privacy/",
      "/terms/",
    ]),
  defaultCategory: "history",
  categories: ["history", "science", "culture", "travel", "tech"],
  // Long-form magazine: everything it publishes is substantive reading practice.
  readingCategories: ["history", "science", "culture", "travel", "tech"],
  cleanup: {
    dropLinkHrefKeywords: [
      "subscribe.smithsonianmag.com",
      "promo_name=",
      "article-banner-ad",
    ],
    dropTextKeywords: [
      "issue of smithsonian magazine",
      "smithsonian magazine participates in affiliate link advertising programs",
      "knowable magazine is an independent journalistic endeavor",
      "this article is from hakai magazine",
    ],
  },
  categoryFor: (url, section) =>
    lookupSection(url, section, [
      [/innovation/, "tech"],
      [/history|heritage|archaeolog|ancient/, "history"],
      [/travel|destination/, "travel"],
      [/science.?(&|and|-).?nature|science-nature|\bscience\b|\bnature\b/, "science"],
      [/arts.?(&|and|-).?culture|arts-culture|\barts\b|culture/, "culture"],
    ]),
};

export default smithsonian;
