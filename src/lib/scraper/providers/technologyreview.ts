import type { Provider } from "@/lib/scraper/types";
import { categoryFromRules, excludes } from "./shared";

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
  categories: ["tech", "science"],
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/artificial-intelligence|computing|technology|digital|\bai\b/, "tech"],
        [/biotechnology|climate|space|science/, "science"],
        [/business|econom/, "business"],
        [/culture/, "culture"],
        [/policy|politic/, "politics"],
      ],
      "tech",
    ),
};

export default technologyreview;
