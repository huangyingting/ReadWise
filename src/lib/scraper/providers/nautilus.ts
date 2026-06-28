import type { Provider } from "@/lib/scraper/types";
import { categoryFromRules, excludes, rssUrlExtractor } from "./shared";
import { fetchNautilusUrls } from "@/lib/scraper/wp-api";

const nautilusRssExtractor = rssUrlExtractor(["https://nautil.us/feed"]);

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
  categories: ["science", "ideas", "environment", "health"],
  // Long-form magazine: everything it publishes is substantive reading practice.
  readingCategories: ["science", "ideas", "environment", "health"],
  cleanup: {
    dropClassKeywords: [
      "ArticleNewsletterBlock",
      "NewsletterBlock",
      "SiteHeader",
      "PopoutNav",
      "newsletter",
      "subscribe",
      "SubscribeBtn",
    ],
  },
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/environment|earth|ocean|climate|ecolog/, "environment"],
        [/mind|consciousness|philosophy|idea/, "ideas"],
        [/health|medic|wellness/, "health"],
        [/culture/, "culture"],
        [/biology|cosmos|life|science/, "science"],
      ],
      "science",
    ),
  /**
   * Discovers article URLs via the Nautilus WordPress REST API, falling back
   * to the RSS feed when the API yields nothing (it currently 404s). Discovery
   * validates every candidate against `articleUrlPattern` / `articleUrlFilter`.
   */
  urlExtractor: async (ctx) => {
    const api = await fetchNautilusUrls(ctx.limit, ctx.fetch);
    return api.length ? api : nautilusRssExtractor(ctx);
  },
};

export default nautilus;
