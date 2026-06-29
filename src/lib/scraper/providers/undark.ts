import type { Provider } from "@/lib/scraper/types";
import { excludes, lookupSection, rssUrlExtractor } from "./shared";

const UNDARK_WORDPRESS_API =
  "https://public-api.wordpress.com/rest/v1.1/sites/undark.org/posts/";
const UNDARK_API_PAGE_SIZE = 100;

type WordPressPostsResponse = {
  found?: number;
  posts?: Array<{ URL?: unknown; link?: unknown }>;
};

function parseWordPressPostUrls(raw: string): { found: number | null; urls: string[] } {
  const parsed = JSON.parse(raw) as WordPressPostsResponse;
  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];
  const urls = posts
    .map((post) => (typeof post.URL === "string" ? post.URL : post.link))
    .filter((url): url is string => typeof url === "string" && url.length > 0)
    .map((url) => {
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname === "undark.org" || parsedUrl.hostname === "race.undark.org") {
          parsedUrl.protocol = "https:";
        }
        return parsedUrl.href;
      } catch {
        return url;
      }
    });
  return {
    found: typeof parsed.found === "number" && Number.isFinite(parsed.found) ? parsed.found : null,
    urls,
  };
}

const undarkRssFallback = rssUrlExtractor(["https://undark.org/feed/"]);

async function undarkUrlExtractor(ctx: Parameters<NonNullable<Provider["urlExtractor"]>>[0]): Promise<string[]> {
  const requestedAll = !Number.isFinite(ctx.limit);
  const pageSize = requestedAll
    ? UNDARK_API_PAGE_SIZE
    : Math.min(UNDARK_API_PAGE_SIZE, Math.max(10, Math.ceil(ctx.limit) * 2));
  const candidateCap = requestedAll ? Number.POSITIVE_INFINITY : Math.max(ctx.limit * 2, ctx.limit);
  const seen = new Set<string>();
  const urls: string[] = [];

  try {
    for (let page = 1; urls.length < candidateCap; page++) {
      const apiUrl = new URL(UNDARK_WORDPRESS_API);
      apiUrl.searchParams.set("number", String(pageSize));
      apiUrl.searchParams.set("page", String(page));
      apiUrl.searchParams.set("status", "publish");
      apiUrl.searchParams.set("type", "post");
      apiUrl.searchParams.set("fields", "URL");

      const { found, urls: pageUrls } = parseWordPressPostUrls(await ctx.fetch(apiUrl.href));
      if (pageUrls.length === 0) break;

      for (const url of pageUrls) {
        if (seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
        if (urls.length >= candidateCap) break;
      }

      if (found !== null && page * pageSize >= found) break;
    }
  } catch {
    // The public WordPress.com endpoint is preferred for complete history, but
    // the latest RSS feed is still a useful degraded discovery path.
    return undarkRssFallback(ctx);
  }

  return urls.length > 0 ? urls : undarkRssFallback(ctx);
}

const undark: Provider = {
  key: "undark",
  name: "Undark",
  hostnames: ["undark.org", "www.undark.org", "race.undark.org"],
  seeds: [
    "https://undark.org/tag/academia/",
    "https://undark.org/tag/climate-change/",
    "https://undark.org/tag/environment-conservation/",
    "https://undark.org/tag/fish-wildlife/",
    "https://undark.org/tag/health-medicine/",
    "https://undark.org/tag/math-physics/",
    "https://undark.org/tag/natural-sciences/",
    "https://undark.org/tag/science-policy/",
    "https://undark.org/tag/social-sciences/",
    "https://undark.org/tag/space-astronomy/",
    "https://undark.org/tag/technology-innovation/",
  ],
  articleUrlPattern:
    /^https:\/\/(?:(?:www\.)?undark\.org\/(?:\d{4}\/\d{2}\/\d{2}\/[a-z0-9_-]+|[a-z0-9-]+)\/?|race\.undark\.org\/articles\/[a-z0-9-]+\/?)(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/tag/",
      "/category/",
      "/author/",
      "/page/",
      "/about",
      "/contact",
      "/newsletter",
      "/subscribe",
      "/team",
      "/funding/",
      "/corrections",
      "/feed",
      "/wp-",
    ]),
  defaultCategory: "science",
  categories: ["science", "environment", "animals", "health", "tech", "politics", "culture"],
  // Long-form science magazine: everything it publishes is substantive reading
  // practice — even its globally-"low" politics is in-depth science policy.
  readingCategories: ["science", "environment", "animals", "health", "tech", "politics", "culture"],
  cleanup: {
    dropClassKeywords: [
      "newsletter",
      "Newsletter",
      "journeys",
      "signup",
      "sign-up",
      "promo",
    ],
    dropTextKeywords: [
      "newsletter journeys",
      "dive deeper into pressing issues",
      "limited run newsletters",
      "hand-picked archive excerpt",
      "support undark magazine",
      "undark is a non-profit, editorially independent magazine",
      "help support our journalism",
    ],
  },
  categoryFor: (url, section) =>
    lookupSection(url, section, [
      [/health.?(&|and).?medicine|health-medicine|\bhealth\b|medicine|drugs|addiction|covid/, "health"],
      [/fish.?(&|and).?wildlife|fish-wildlife|wildlife/, "animals"],
      [/environment.?(&|and).?conservation|environment-conservation|\benvironment\b|conservation|climate|sustainab|ecolog/, "environment"],
      [/technology.?(&|and).?innovation|technology-innovation|technology|innovation/, "tech"],
      [/science.?policy|science-policy|\bpolicy\b/, "politics"],
      [/social.?science|social-science/, "culture"],
      [/\bbooks?\b/, "culture"],
      [/space.?(&|and).?astronomy|space-astronomy|space|astronom|math.?(&|and).?physics|math-physics|\bmath\b|physics|natural.?science|natural-science|\bscience\b/, "science"],
    ]),
  /**
   * Discovers article URLs from Undark's public WordPress.com posts endpoint,
   * which exposes the complete publish history while seed/sitemap HTML is
   * Cloudflare-blocked. Falls back to the latest RSS feed if the API is
   * unavailable. Discovery still validates hostname, URL pattern, provider
   * filters, and robots rules before returning candidates.
   */
  urlExtractor: undarkUrlExtractor,
};

export default undark;
