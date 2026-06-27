import type { Provider } from "@/lib/scraper/types";
import { mapSectionToCategory, excludes } from "./shared";

const time: Provider = {
  key: "time",
  name: "Time",
  hostnames: ["time.com", "www.time.com"],
  seeds: [
    "https://time.com/",
    "https://time.com/section/world/",
    "https://time.com/section/politics/",
    "https://time.com/section/health/",
    "https://time.com/section/business/",
  ],
  // Time article URLs have used both /article/YYYY/MM/DD/slug/ and /NNNNNNN/slug/ formats.
  articleUrlPattern: /time\.com\/(?:article\/\d{4}\/\d{2}\/\d{2}\/|\d{7}\/[a-z0-9-]+\/?)/i,
  articleUrlFilter: (url) => excludes(url, ["/collection", "/tag/", "/author/"]),
  defaultCategory: "world",
  categories: ["world", "politics", "business", "health", "science", "tech", "entertainment", "sports"],
  categoryFor: (url, section) =>
    mapSectionToCategory(section) ??
    mapSectionToCategory(url.pathname.replace(/\/article\/\d{4}\/\d{2}\/\d{2}\//, "/")),
};

export default time;
