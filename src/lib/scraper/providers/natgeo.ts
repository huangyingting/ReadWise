import type { Provider } from "@/lib/scraper/types";
import { categoryFromFirstSegment, excludes } from "./shared";

const natgeo: Provider = {
  key: "natgeo",
  name: "National Geographic",
  hostnames: ["nationalgeographic.com", "www.nationalgeographic.com"],
  seeds: [
    "https://www.nationalgeographic.com/science",
    "https://www.nationalgeographic.com/environment",
    "https://www.nationalgeographic.com/animals",
    "https://www.nationalgeographic.com/history",
    "https://www.nationalgeographic.com/travel",
  ],
  articleUrlPattern: /\/article\//i,
  defaultCategory: "science",
  categories: ["environment", "science", "history", "travel", "culture"],
  categoryFor: categoryFromFirstSegment,
  cleanup: {
    dropSelectors: ["video", "iframe", "aside"],
    dropClassKeywords: ["related", "social", "newsletter", "promo"],
  },
};

export default natgeo;
