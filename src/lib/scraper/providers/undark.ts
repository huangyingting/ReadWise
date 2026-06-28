import type { Provider } from "@/lib/scraper/types";
import { excludes, lookupSection, rssUrlExtractor } from "./shared";

const undark: Provider = {
  key: "undark",
  name: "Undark",
  hostnames: ["undark.org", "www.undark.org"],
  seeds: [
    "https://undark.org/tag/academia/",
    "https://undark.org/tag/climate-change/",
    "https://undark.org/tag/environment-conservation/",
    "https://undark.org/tag/fish-wildlife/",
    "https://undark.org/tag/health-medicine/",
    "https://undark.org/tag/math-physics/",
    "https://undark.org/tag/natural-sciences/",
    "https://undark.org/tag/science-policy/",
    "https://undark.org/tag/social-sciences/",
    "https://undark.org/tag/space-astronomy/",
    "https://undark.org/tag/technology-innovation/",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?undark\.org\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/tag/",
      "/category/",
      "/author/",
      "/page/",
      "/about",
      "/contact",
      "/newsletter",
      "/subscribe",
      "/team",
      "/funding",
      "/corrections",
      "/feed",
      "/wp-",
    ]),
  defaultCategory: "science",
  categories: ["science", "environment", "animals", "health", "tech", "politics", "culture"],
  // Long-form science magazine: everything it publishes is substantive reading
  // practice — even its globally-"low" politics is in-depth science policy.
  readingCategories: ["science", "environment", "animals", "health", "tech", "politics", "culture"],
  categoryFor: (url, section) =>
    lookupSection(url, section, [
      [/health.?(&|and).?medicine|health-medicine|\bhealth\b|medicine|drugs|addiction|covid/, "health"],
      [/fish.?(&|and).?wildlife|fish-wildlife|wildlife/, "animals"],
      [/environment.?(&|and).?conservation|environment-conservation|\benvironment\b|conservation|climate|sustainab|ecolog/, "environment"],
      [/technology.?(&|and).?innovation|technology-innovation|technology|innovation/, "tech"],
      [/science.?policy|science-policy|\bpolicy\b/, "politics"],
      [/social.?science|social-science/, "culture"],
      [/\bbooks?\b/, "culture"],
      [/space.?(&|and).?astronomy|space-astronomy|space|astronom|math.?(&|and).?physics|math-physics|\bmath\b|physics|natural.?science|natural-science|\bscience\b/, "science"],
    ]),
  /**
   * Discovers article URLs from Undark's RSS feed (the seed-HTML pages are
   * blocked with 403). Candidates are validated against `articleUrlPattern`
   * and `articleUrlFilter` by discovery.
   */
  urlExtractor: rssUrlExtractor(["https://undark.org/feed/"]),
};

export default undark;
