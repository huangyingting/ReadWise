import type { Provider } from "@/lib/scraper/types";
import { categoryFromRules, excludes, rssUrlExtractor } from "./shared";
import { fetchAeonUrls } from "@/lib/scraper/aeon-graphql";

const aeonRssExtractor = rssUrlExtractor(["https://aeon.co/feed.rss"]);

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
  defaultCategory: "ideas",
  categories: ["ideas", "science", "culture", "politics"],
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/philosophy|idea|essay|consciousness|ethic/, "ideas"],
        [/society|politic|democracy/, "politics"],
        [/science|psychology/, "science"],
        [/culture|art/, "culture"],
      ],
      "ideas",
    ),
  /**
   * Discovers essay URLs via Aeon's GraphQL API with cursor pagination,
   * falling back to the RSS feed when the API yields nothing (it currently
   * 404s). Non-essay nodes are filtered out. Discovery validates every
   * candidate against `articleUrlPattern` / `articleUrlFilter`.
   */
  urlExtractor: async (ctx) => {
    const api = await fetchAeonUrls(ctx.limit, ctx.fetch);
    return api.length ? api : aeonRssExtractor(ctx);
  },
};

export default aeon;
