import type { Provider } from "@/lib/scraper/types";
import { mapSectionToCategory } from "./shared";

const bbcLearningEnglish: Provider = {
  key: "bbc-learning-english",
  name: "BBC Learning English",
  hostnames: ["bbc.co.uk", "www.bbc.co.uk"],
  seeds: [
    "https://www.bbc.co.uk/learningenglish/english/features/6-minute-english",
    "https://www.bbc.co.uk/learningenglish/english/features/news-report",
    "https://www.bbc.co.uk/learningenglish/english/features/lingohack",
  ],
  // BBC Learning English article paths contain /learningenglish/ and end with a numeric id.
  articleUrlPattern: /\/learningenglish\/english\//i,
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
