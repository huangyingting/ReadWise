import type { Provider } from "@/lib/scraper/types";
import { mapSectionToCategory } from "./shared";

/**
 * A bare BBC Learning English feature INDEX URL — e.g.
 * `…/learningenglish/english/features/6-minute-english` — with no trailing
 * episode segment. These are the crawl seeds (episode-listing pages), NOT
 * articles, so they must be excluded from article discovery.
 */
const FEATURE_INDEX_RE = /\/learningenglish\/english\/features\/[a-z0-9-]+\/?(?:[?#].*)?$/i;

const bbcLearningEnglish: Provider = {
  key: "bbc-learning-english",
  name: "BBC Learning English",
  hostnames: ["bbc.co.uk", "www.bbc.co.uk"],
  seeds: [
    "https://www.bbc.co.uk/learningenglish/english/features/6-minute-english",
    "https://www.bbc.co.uk/learningenglish/english/features/news-report",
    "https://www.bbc.co.uk/learningenglish/english/features/lingohack",
  ],
  // Individual episode/lesson pages live UNDER a feature segment and end with an
  // episode segment, e.g. `…/features/6-minute-english/ep-260618`. Requiring the
  // `ep-<digits>` / `episode…` segment prevents the feature INDEX (seed) pages
  // — which list every episode — from being scraped as one giant "article".
  articleUrlPattern:
    /\/learningenglish\/english\/features\/[a-z0-9-]+\/(?:ep-?\d+|episode[\w-]*)/i,
  // Defense in depth: explicitly reject the bare feature index/seed URLs even if
  // a future pattern change loosened the regex above.
  articleUrlFilter: (url) => !FEATURE_INDEX_RE.test(url),
  defaultCategory: "culture",
  categories: ["world", "culture"],
  categoryFor: (url, section) => {
    const path = url.pathname.toLowerCase();
    // Map BBC LE feature paths to categories.
    if (/science|environment|nature/.test(path)) return "science";
    if (/business|econom|market/.test(path)) return "business";
    if (/health|medical/.test(path)) return "health";
    if (/tech|digital|internet/.test(path)) return "tech";
    if (/sport/.test(path)) return "sports";
    if (/politic|govern/.test(path)) return "politics";
    return mapSectionToCategory(section) ?? "culture";
  },
};

export default bbcLearningEnglish;
