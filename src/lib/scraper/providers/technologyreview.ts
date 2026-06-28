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
  /**
   * Pre-extraction noise removal (see `src/lib/scraper/cleanup.ts`). MIT pages
   * render two trailing widgets *inside* the article container that the body
   * harvest would otherwise keep:
   *   1. A "Stay Connected" newsletter signup form whose hidden response text
   *      ("…thank you for submitting your email!… reach out to us at
   *      customer-service@technologyreview.com…") leaks into the prose.
   *   2. A "Deep Dive" related-articles rail (section title + post cards).
   *
   * MIT ships CSS-module hashed class names (e.g. `stayConnected__link--<hash>`,
   * `deepDiveItem__wrapper`), and matching here is a case-insensitive class/id
   * SUBSTRING test on block containers (BLOCK_CONTAINER_TAGS), so:
   *   - `stayConnected` removes the whole newsletter form.
   *   - `deepDiveItem` removes the related post cards, and
   *     `deepDive__sectionTitle` removes the bare "Deep Dive" heading.
   *
   * We deliberately do NOT drop the outer `deepDive__wrapper`: emptying it (vs.
   * removing it) lets the shared declutter pass collapse the leftover blanks
   * while keeping Readability's body/lead-image scoring stable — dropping the
   * whole wrapper flips short features to a truncated body and drops the lead
   * image. Article inline images live outside these widgets and are preserved.
   */
  cleanup: {
    dropClassKeywords: ["stayConnected", "deepDiveItem", "deepDive__sectionTitle"],
  },
};

export default technologyreview;
