import type { Provider } from "@/lib/scraper/types";
import { categoryFromRules, excludes } from "./shared";
import { fetchNautilusUrls } from "@/lib/scraper/wp-api";

const nautilus: Provider = {
  key: "nautilus",
  name: "Nautilus",
  hostnames: ["nautil.us", "www.nautil.us"],
  seeds: [
    "https://nautil.us/art-science/",
    "https://nautil.us/biology-beyond/",
    "https://nautil.us/cosmos/",
    "https://nautil.us/culture/",
    "https://nautil.us/earth/",
    "https://nautil.us/life/",
    "https://nautil.us/mind/",
    "https://nautil.us/ocean/",
  ],
  articleUrlPattern: /^https:\/\/(?:www\.)?nautil\.us\/[a-z0-9-]+-\d+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/page/",
      "/category/",
      "/tag/",
      "/author/",
      "/about",
      "/contact",
      "/newsletter",
      "/join",
      "/shop",
      "/feed",
      "/wp-",
      "/concierge",
    ]),
  defaultCategory: "science",
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/culture/, "culture"],
        [/mind|biology|cosmos|earth|life|ocean|science/, "science"],
      ],
      "science",
    ),
  /**
   * Discovers article URLs via the Nautilus WordPress REST API.
   * Falls back to an empty list on any API failure.
   */
  urlExtractor: async ({ limit, fetch: fetchFn }) => fetchNautilusUrls(limit, fetchFn),
};

export default nautilus;
