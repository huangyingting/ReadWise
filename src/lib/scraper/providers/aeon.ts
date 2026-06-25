import type { Provider } from "@/lib/scraper/types";
import { categoryFromRules, excludes } from "./shared";
import { fetchAeonUrls } from "@/lib/scraper/aeon-graphql";

const aeon: Provider = {
  key: "aeon",
  name: "Aeon",
  hostnames: ["aeon.co", "www.aeon.co"],
  seeds: [
    "https://aeon.co/philosophy",
    "https://aeon.co/psychology",
    "https://aeon.co/society",
    "https://aeon.co/science",
    "https://aeon.co/culture",
  ],
  articleUrlPattern: /^https:\/\/(?:www\.)?aeon\.co\/essays\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/about",
      "/contact",
      "/support",
      "/donate",
      "/feed",
      "/privacy",
      "/terms",
      "/community-guidelines",
      "?utm_source",
    ]),
  defaultCategory: "culture",
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/science|psychology/, "science"],
        [/society|politic|democracy/, "politics"],
        [/philosophy|culture/, "culture"],
      ],
      "culture",
    ),
  /**
   * Discovers essay URLs via Aeon's GraphQL API with cursor pagination.
   * Filters out non-essay nodes (videos etc.). Falls back to empty on error.
   */
  urlExtractor: async ({ limit, fetch: fetchFn }) => fetchAeonUrls(limit, fetchFn),
};

export default aeon;
