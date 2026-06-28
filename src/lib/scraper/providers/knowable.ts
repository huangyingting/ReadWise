import type { Provider } from "@/lib/scraper/types";
import { excludes, lookupSection, rssUrlExtractor } from "./shared";

const knowable: Provider = {
  key: "knowable",
  name: "Knowable Magazine",
  hostnames: ["knowablemagazine.org", "www.knowablemagazine.org"],
  seeds: [
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=physical-world&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/physical-world",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=technology&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/technology",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=living-world&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/living-world",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=society&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/society",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=food-environment&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/food-environment",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?knowablemagazine\.org\/(?:content\/)?article\/[a-z-]+\/\d{4}\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) => excludes(url, ["/search", "/about", "/contact", "/subscribe"]),
  defaultCategory: "science",
  categories: ["science", "environment", "health", "tech", "culture"],
  // Long-form magazine: everything it publishes is substantive reading practice.
  readingCategories: ["science", "environment", "health", "tech", "culture"],
  categoryFor: (url, section) =>
    lookupSection(url, section, [
      [/technology|computing|digital/, "tech"],
      [/health.?(&|and).?disease|\bhealth\b|disease|medical/, "health"],
      [/food.?(&|and).?environment|food-environment|environment|climate|sustainab|conservation|ecolog/, "environment"],
      [/living.?world|physical.?world|the.?mind|\bmind\b|\bscience\b/, "science"],
      [/\bsociety\b|culture/, "culture"],
      [/business|econom/, "business"],
    ]),
  /**
   * Discovers article URLs from Knowable's RSS feed (the seed search pages are
   * blocked with 403). Candidates are validated against `articleUrlPattern`
   * and `articleUrlFilter` by discovery.
   */
  urlExtractor: rssUrlExtractor(["https://knowablemagazine.org/rss"]),
};

export default knowable;
