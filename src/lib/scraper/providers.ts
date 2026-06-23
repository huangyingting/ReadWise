import { CATEGORY_SLUGS } from "@/lib/categories";
import type { Provider } from "@/lib/scraper/types";
import { parseRssUrls } from "@/lib/scraper/rss";
import { fetchNautilusUrls } from "@/lib/scraper/wp-api";
import { fetchAeonUrls } from "@/lib/scraper/aeon-graphql";

/**
 * Maps a free-form section/topic string (from a URL path or article metadata)
 * onto one of our canonical category slugs. Returns null when nothing matches.
 */
export function mapSectionToCategory(section: string | null): string | null {
  if (!section) return null;
  const s = section.toLowerCase();

  const rules: Array<[RegExp, string]> = [
    [/\b(world|global|international|asia|europe|africa|americas|middle.?east)/, "world"],
    [/\b(politic|election|congress|white.?house|government|policy)/, "politics"],
    [/\b(business|money|econom|market|finance|deal|compan|industr)/, "business"],
    [/\b(health|wellness|coronavirus|covid|medic|fitness|disease)/, "health"],
    [/\b(science|scien|environment|climate|space|nature|animal|wildlife|planet)/, "science"],
    [/\b(tech|gadget|software|hardware|\bai\b|artificial.?intelligence|internet|digital)/, "tech"],
    [/\b(sport|nfl|nba|mlb|soccer|football|olympic)/, "sports"],
    [/\b(culture|art|book|style|travel|food|histor|fashion|design)/, "culture"],
    [/\b(entertainment|celebrit|tv|television|movie|film|music|hollywood|gaming|game)/, "entertainment"],
  ];

  for (const [pattern, slug] of rules) {
    if (pattern.test(s) && CATEGORY_SLUGS.includes(slug)) {
      return slug;
    }
  }
  return null;
}

/** Picks the first non-empty path segment of a URL (e.g. "/health/foo" -> "health"). */
function firstSegment(url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  return segments[0] ?? null;
}

const categoryFromFirstSegment = (url: URL, section: string | null): string | null =>
  mapSectionToCategory(section) ?? mapSectionToCategory(firstSegment(url));

function categoryFromRules(
  url: URL,
  section: string | null,
  rules: ReadonlyArray<readonly [RegExp, string]>,
  fallback: string | null,
): string | null {
  const haystack = `${section ?? ""} ${url.pathname}`.toLowerCase();
  for (const [pattern, slug] of rules) {
    if (pattern.test(haystack) && CATEGORY_SLUGS.includes(slug)) return slug;
  }
  return categoryFromFirstSegment(url, section) ?? fallback;
}

function excludes(url: string, fragments: readonly string[]): boolean {
  const lower = url.toLowerCase();
  return !fragments.some((fragment) => lower.includes(fragment));
}

/**
 * BBC News RSS feeds keyed by ReadWise category slug. Where BBC doesn't have
 * a dedicated feed, the nearest thematic feed is used as a fallback.
 *
 * Feed index: https://www.bbc.co.uk/news/10628494
 */
const BBC_RSS_FEEDS: Record<string, string> = {
  world:         "https://feeds.bbci.co.uk/news/world/rss.xml",
  politics:      "https://feeds.bbci.co.uk/news/politics/rss.xml",
  business:      "https://feeds.bbci.co.uk/news/business/rss.xml",
  health:        "https://feeds.bbci.co.uk/news/health/rss.xml",
  science:       "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
  tech:          "https://feeds.bbci.co.uk/news/technology/rss.xml",
  entertainment: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
  // culture & sports share related feeds
  culture:       "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
  sports:        "https://feeds.bbci.co.uk/sport/rss.xml",
};

function isBbcNewsArticleUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const hasArticlePath =
    /\/news\/articles\/[a-z0-9]+/.test(lower) || /\/news\/[a-z0-9_-]+-\d{6,}/.test(lower);
  return (
    hasArticlePath &&
    excludes(lower, ["/live/", "/in_pictures", "/av/", "/topics/", "/correspondents/"])
  );
}

export const PROVIDERS: readonly Provider[] = [
  {
    key: "nbc",
    name: "NBC News",
    hostnames: ["nbcnews.com", "www.nbcnews.com"],
    seeds: [
      "https://www.nbcnews.com/world",
      "https://www.nbcnews.com/politics",
      "https://www.nbcnews.com/health",
      "https://www.nbcnews.com/science",
      "https://www.nbcnews.com/business",
    ],
    // NBC article slugs end with an "-rcnaNNNNN" id.
    articleUrlPattern: /\/[a-z0-9-]+-rcna\d+/i,
    articleUrlFilter: (url) =>
      excludes(url, ["/live-blog/", "/video/", "/nbc-news-now-live-audio", "select/shopping"]),
    defaultCategory: "world",
    categoryFor: categoryFromFirstSegment,
  },
  {
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
    categoryFor: categoryFromFirstSegment,
  },
  {
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
    categoryFor: (url, section) =>
      mapSectionToCategory(section) ??
      mapSectionToCategory(url.pathname.replace(/\/article\/\d{4}\/\d{2}\/\d{2}\//, "/")),
  },
  {
    key: "huffpost",
    name: "HuffPost",
    hostnames: ["huffpost.com", "www.huffpost.com"],
    seeds: [
      "https://www.huffpost.com/news/world-news",
      "https://www.huffpost.com/news/politics",
      "https://www.huffpost.com/life/wellness",
      "https://www.huffpost.com/entertainment",
      "https://www.huffpost.com/news/business",
    ],
    articleUrlPattern: /\/entry\//i,
    articleUrlFilter: (url) => excludes(url, ["/video/", "/voices/", "/section/"]),
    defaultCategory: "world",
    categoryFor: categoryFromFirstSegment,
  },
  {
    key: "bbc",
    name: "BBC News",
    hostnames: ["bbc.com", "www.bbc.com", "bbc.co.uk", "www.bbc.co.uk"],
    seeds: [
      "https://www.bbc.com/news/world",
      "https://www.bbc.com/news/technology",
      "https://www.bbc.com/news/business",
      "https://www.bbc.com/news/science_and_environment",
      "https://www.bbc.com/news/health",
      "https://www.bbc.com/news/entertainment_and_arts",
    ],
    articleUrlPattern:
      /^https:\/\/(?:www\.)?bbc\.(?:com|co\.uk)\/news\/(?:articles\/[a-z0-9]+|[a-z0-9_-]+-\d{6,})(?:[/?#].*)?$/i,
    articleUrlFilter: isBbcNewsArticleUrl,
    defaultCategory: "world",
    categoryFor: (url, section) =>
      categoryFromRules(
        url,
        section,
        [
          [/world|global|international|us[-_]and[-_]canada/, "world"],
          [/politic|election|government/, "politics"],
          [/business|econom|market|money/, "business"],
          [/technology|innovation|tech|\bai\b/, "tech"],
          [/science|environment|climate/, "science"],
          [/health|medical/, "health"],
          [/entertainment|arts|culture/, "entertainment"],
          [/sport/, "sports"],
        ],
        "world",
      ),
    /**
     * Discovers article URLs from BBC News RSS feeds (one per category).
     * Falls back gracefully if individual feeds are unreachable.
     */
    urlExtractor: async ({ limit, fetch: fetchFn }) => {
      const urls: string[] = [];
      for (const feedUrl of Object.values(BBC_RSS_FEEDS)) {
        if (urls.length >= limit * 2) break;
        try {
          const xml = await fetchFn(feedUrl);
          urls.push(...parseRssUrls(xml));
        } catch {
          // graceful degradation — a single feed failure doesn't stop discovery
        }
      }
      return urls;
    },
  },
  {
    key: "smithsonian",
    name: "Smithsonian Magazine",
    hostnames: ["smithsonianmag.com", "www.smithsonianmag.com"],
    seeds: [
      "https://www.smithsonianmag.com/category/science-nature/",
      "https://www.smithsonianmag.com/category/history/",
      "https://www.smithsonianmag.com/category/arts-culture/",
      "https://www.smithsonianmag.com/category/travel/",
      "https://www.smithsonianmag.com/category/innovation/",
    ],
    articleUrlPattern:
      /^https:\/\/(?:www\.)?smithsonianmag\.com\/[a-z-]+\/[a-z0-9-]+-\d+\/?(?:[?#].*)?$/i,
    articleUrlFilter: (url) =>
      excludes(url, [
        "/category/",
        "/tag/",
        "/author/",
        "/videos/",
        "/photocontest/",
        "/search/",
        "/subscribe/",
        "/privacy/",
        "/terms/",
      ]),
    defaultCategory: "science",
    categoryFor: (url, section) =>
      categoryFromRules(
        url,
        section,
        [
          [/science|nature|innovation/, "science"],
          [/history|arts|culture|travel/, "culture"],
        ],
        "science",
      ),
  },
  {
    key: "knowable",
    name: "Knowable Magazine",
    hostnames: ["knowablemagazine.org", "www.knowablemagazine.org"],
    seeds: [
      "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=physical-world&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/physical-world",
      "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=technology&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/technology",
      "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=living-world&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/living-world",
      "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=society&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/society",
      "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=food-environment&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/food-environment",
    ],
    articleUrlPattern:
      /^https:\/\/(?:www\.)?knowablemagazine\.org\/(?:content\/)?article\/[a-z-]+\/\d{4}\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
    articleUrlFilter: (url) => excludes(url, ["/search", "/about", "/contact", "/subscribe"]),
    defaultCategory: "science",
    categoryFor: (url, section) =>
      categoryFromRules(
        url,
        section,
        [
          [/technology|digital|computing/, "tech"],
          [/living-world|physical-world|food-environment|science|environment/, "science"],
          [/society|culture/, "culture"],
          [/health|medical/, "health"],
          [/business|econom/, "business"],
        ],
        "science",
      ),
  },
  {
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
  },
  {
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
  },
  {
    key: "technologyreview",
    name: "MIT Technology Review",
    hostnames: ["technologyreview.com", "www.technologyreview.com"],
    seeds: [
      "https://www.technologyreview.com/topic/artificial-intelligence",
      "https://www.technologyreview.com/topic/biotechnology",
      "https://www.technologyreview.com/topic/climate-change",
      "https://www.technologyreview.com/topic/computing",
      "https://www.technologyreview.com/topic/business",
      "https://www.technologyreview.com/topic/culture",
      "https://www.technologyreview.com/topic/space",
    ],
    articleUrlPattern:
      /^https:\/\/(?:www\.)?technologyreview\.com\/\d{4}\/\d{2}\/\d{2}\/\d+\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
    articleUrlFilter: (url) =>
      excludes(url, [
        "/author/",
        "/topic/",
        "/newsletter/",
        "/podcasts/",
        "/events/",
        "/lists/",
        "/subscribe",
        "/about",
        "/sitemap",
      ]),
    defaultCategory: "tech",
    categoryFor: (url, section) =>
      categoryFromRules(
        url,
        section,
        [
          [/artificial-intelligence|computing|technology|digital|\bai\b/, "tech"],
          [/biotechnology|climate|space|science/, "science"],
          [/business|econom/, "business"],
          [/culture/, "culture"],
          [/policy|politic/, "politics"],
        ],
        "tech",
      ),
  },
  {
    key: "noema",
    name: "Noema Magazine",
    hostnames: ["noemamag.com", "www.noemamag.com"],
    seeds: [
      "https://www.noemamag.com/article-topic/technology-and-the-human/",
      "https://www.noemamag.com/article-topic/future-of-capitalism/",
      "https://www.noemamag.com/article-topic/philosophy-culture/",
      "https://www.noemamag.com/article-topic/climate-crisis/",
      "https://www.noemamag.com/article-topic/geopolitics-globalization/",
      "https://www.noemamag.com/article-topic/future-of-democracy/",
      "https://www.noemamag.com/article-topic/digital-society/",
    ],
    articleUrlPattern: /^https:\/\/(?:www\.)?noemamag\.com\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
    articleUrlFilter: (url) =>
      excludes(url, [
        "/article-topic/",
        "/article-type/",
        "/author/",
        "/tag/",
        "/about",
        "/contact",
        "/newsletter",
        "/masthead",
        "/careers",
        "/feed",
        "/wp-",
        "/articles-search",
      ]),
    defaultCategory: "culture",
    categoryFor: (url, section) =>
      categoryFromRules(
        url,
        section,
        [
          [/technology|digital|human/, "tech"],
          [/capitalism|business|econom/, "business"],
          [/climate|science/, "science"],
          [/geopolitics|globalization|democracy|politic/, "politics"],
          [/philosophy|culture/, "culture"],
        ],
        "culture",
      ),
  },
  {
    key: "undark",
    name: "Undark",
    hostnames: ["undark.org", "www.undark.org"],
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
      /^https:\/\/(?:www\.)?undark\.org\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
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
        "/funding",
        "/corrections",
        "/feed",
        "/wp-",
      ]),
    defaultCategory: "science",
    categoryFor: (url, section) =>
      categoryFromRules(
        url,
        section,
        [
          [/health|medicine|covid|drugs/, "health"],
          [/technology|innovation/, "tech"],
          [/policy|social-sciences|academia/, "politics"],
          [/climate|environment|wildlife|physics|natural-sciences|space|science/, "science"],
        ],
        "science",
      ),
  },
  {
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
  },
  {
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
  },
];

export function getProvider(key: string): Provider | null {
  return PROVIDERS.find((p) => p.key === key.toLowerCase()) ?? null;
}

/** Finds the provider that owns a given URL by hostname match. */
export function providerForUrl(rawUrl: string): Provider | null {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  const hostMatches = PROVIDERS.filter((p) =>
    p.hostnames.some((h) => h.replace(/^www\./, "") === host),
  );
  return hostMatches.find((p) => p.articleUrlPattern.test(rawUrl)) ?? hostMatches[0] ?? null;
}
