import type { Provider } from "@/lib/scraper/types";
import { mapSectionToCategory, categoryFromFirstSegment } from "./shared";

const voaLearningEnglish: Provider = {
  key: "voa-learning-english",
  name: "VOA Learning English",
  hostnames: ["learningenglish.voanews.com"],
  seeds: [
    "https://learningenglish.voanews.com/news",
    "https://learningenglish.voanews.com/science-technology",
    "https://learningenglish.voanews.com/health-lifestyle",
    "https://learningenglish.voanews.com/world",
    "https://learningenglish.voanews.com/arts-culture",
  ],
  // VOA Learning English article paths: /a/<slug>.html
  articleUrlPattern: /\/a\/[a-z0-9-]+\.html/i,
  defaultCategory: "world",
  categoryFor: (url, section) => {
    const path = url.pathname.toLowerCase();
    if (/science|tech/.test(path)) return "science";
    if (/health/.test(path)) return "health";
    if (/arts|culture/.test(path)) return "culture";
    if (/sport/.test(path)) return "sports";
    if (/business|econom/.test(path)) return "business";
    return mapSectionToCategory(section) ?? categoryFromFirstSegment(url, section) ?? "world";
  },
};

export default voaLearningEnglish;
