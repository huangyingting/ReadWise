import type { Provider } from "@/lib/scraper/types";
import { categoryFromRules, excludes, rssUrlExtractor } from "./shared";

const noema: Provider = {
  key: "noema",
  name: "Noema Magazine",
  hostnames: ["noemamag.com", "www.noemamag.com"],
  seeds: [
    "https://www.noemamag.com/article-topic/technology-and-the-human/",
    "https://www.noemamag.com/article-topic/future-of-capitalism/",
    "https://www.noemamag.com/article-topic/philosophy-culture/",
    "https://www.noemamag.com/article-topic/climate-crisis/",
    "https://www.noemamag.com/article-topic/geopolitics-globalization/",
    "https://www.noemamag.com/article-topic/future-of-democracy/",
    "https://www.noemamag.com/article-topic/digital-society/",
  ],
  articleUrlPattern: /^https:\/\/(?:www\.)?noemamag\.com\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/article-topic/",
      "/article-type/",
      "/author/",
      "/tag/",
      "/about",
      "/contact",
      "/newsletter",
      "/masthead",
      "/careers",
      "/feed",
      "/wp-",
      "/articles-search",
    ]),
  defaultCategory: "ideas",
  categories: ["ideas", "politics", "culture", "tech", "science", "environment"],
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/technology|digital|human/, "tech"],
        [/capitalism|business|econom/, "business"],
        [/climate|environment|science/, "science"],
        [/philosophy|idea|essay|consciousness/, "ideas"],
        [/geopolitics|globalization|democracy|politic/, "politics"],
        [/culture/, "culture"],
      ],
      "ideas",
    ),
  /**
   * Discovers article URLs from Noema's RSS feed (the seed-HTML pages are
   * blocked with 403). Candidates are validated against `articleUrlPattern`
   * and `articleUrlFilter` by discovery.
   */
  urlExtractor: rssUrlExtractor(["https://www.noemamag.com/?feed=noemarss"]),
};

export default noema;
