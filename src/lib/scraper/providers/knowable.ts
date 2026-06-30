import type { Provider } from "@/lib/scraper/types";
import { parseRssUrls } from "@/lib/scraper/rss";
import { excludes, lookupSection } from "./shared";

const KNOWABLE_RSS_FEED_URL = "https://knowablemagazine.org/rss";
const KNOWABLE_SECTIONS = [
  "physical-world",
  "technology",
  "living-world",
  "society",
  "food-environment",
  "health-disease",
  "mind",
] as const;
const KNOWABLE_TOPICS = [
  "climate-change",
  "comics",
  "coronavirus",
  "disease-update",
  "events",
  "explained",
  "review",
  "opinion",
  "qa",
  "story-behind-picture",
] as const;
const KNOWABLE_SEARCH_FEED_MAX_PAGES = 100;
const KNOWABLE_SEARCH_FEED_EMPTY_PAGE_LIMIT = 2;

function knowableSearchFeedUrl(section: (typeof KNOWABLE_SECTIONS)[number], page: number): string {
  const params = new URLSearchParams({
    option1: "fulltext",
    value1: "",
    operator1: "AND",
    option2: "pub_sectionIdent",
    value2: section,
    operator2: "AND",
    option3: "dcterms_language",
    value3: "language/en",
    sortDescending: "true",
    sortField: "prism_publicationDate",
    section: `/content/${section}`,
    pageSize: "100",
  });
  if (page > 1) params.set("page", String(page));
  return `https://knowablemagazine.org/search/rss.action?${params.toString()}`;
}

function knowableTopicFeedUrl(
  topic: (typeof KNOWABLE_TOPICS)[number],
  page: number,
): string {
  const params = new URLSearchParams({
    option1: "pub_topic",
    value1: `topics/${topic}`,
    section: `/content/topics/${topic}`,
    sectionType: "topic",
    option51: "dcterms_language",
    value51: "language/en",
    sortDescending: "true",
    sortField: "prism_publicationDate",
    pageSize: "100",
  });
  if (page > 1) params.set("page", String(page));
  return `https://knowablemagazine.org/search/rss.action?${params.toString()}`;
}

function addUrls(target: string[], seen: Set<string>, urls: string[]): number {
  let added = 0;
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    target.push(url);
    added++;
  }
  return added;
}

async function fetchRssUrls(
  fetchFn: Parameters<NonNullable<Provider["urlExtractor"]>>[0]["fetch"],
  url: string,
): Promise<string[]> {
  try {
    return parseRssUrls(await fetchFn(url));
  } catch {
    return [];
  }
}

async function knowableUrlExtractor({
  limit,
  fetch: fetchFn,
}: Parameters<NonNullable<Provider["urlExtractor"]>>[0]): Promise<string[]> {
  const seen = new Set<string>();
  const urls: string[] = [];
  const candidateCap = Number.isFinite(limit)
    ? Math.max(limit * 4, limit)
    : Number.POSITIVE_INFINITY;

  addUrls(urls, seen, await fetchRssUrls(fetchFn, KNOWABLE_RSS_FEED_URL));

  const pageSearchFeed = async (feedUrl: (page: number) => string) => {
    const feedSeen = new Set<string>();
    let consecutiveEmptyPages = 0;
    for (let page = 1; page <= KNOWABLE_SEARCH_FEED_MAX_PAGES; page++) {
      if (urls.length >= candidateCap) break;
      const pageUrls = await fetchRssUrls(fetchFn, feedUrl(page));
      const feedAdded = addUrls([], feedSeen, pageUrls);
      addUrls(urls, seen, pageUrls);

      if (feedAdded === 0) {
        consecutiveEmptyPages++;
        if (consecutiveEmptyPages >= KNOWABLE_SEARCH_FEED_EMPTY_PAGE_LIMIT) break;
      } else {
        consecutiveEmptyPages = 0;
      }
    }
  };

  for (const section of KNOWABLE_SECTIONS) {
    if (urls.length >= candidateCap) break;
    await pageSearchFeed((page) => knowableSearchFeedUrl(section, page));
  }

  for (const topic of KNOWABLE_TOPICS) {
    if (urls.length >= candidateCap) break;
    await pageSearchFeed((page) => knowableTopicFeedUrl(topic, page));
  }

  return urls;
}

const knowable: Provider = {
  key: "knowable",
  name: "Knowable Magazine",
  hostnames: ["knowablemagazine.org", "www.knowablemagazine.org"],
  seeds: [
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=physical-world&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/physical-world",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=technology&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/technology",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=living-world&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/living-world",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=society&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/society",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=food-environment&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/food-environment",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=health-disease&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/health-disease",
    "https://knowablemagazine.org/search?option1=fulltext&value1=&operator1=AND&option2=pub_sectionIdent&value2=mind&operator2=AND&option3=dcterms_language&value3=language/en&sortDescending=true&sortField=prism_publicationDate&section=/content/mind",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?knowablemagazine\.org\/(?:content\/)?article\/[a-z-]+\/\d{4}\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) => excludes(url, ["/search", "/about", "/contact", "/subscribe"]),
  defaultCategory: "science",
  categories: ["science", "environment", "health", "tech", "culture"],
  // Long-form magazine: everything it publishes is substantive reading practice.
  readingCategories: ["science", "environment", "health", "tech", "culture"],
  categoryFor: (url, section) =>
    lookupSection(url, section, [
      [/technology|computing|digital/, "tech"],
      [/health.?(&|and).?disease|\bhealth\b|disease|medical/, "health"],
      [/food.?(&|and).?environment|food-environment|environment|climate|sustainab|conservation|ecolog/, "environment"],
      [/living.?world|physical.?world|the.?mind|\bmind\b|\bscience\b/, "science"],
      [/\bsociety\b|culture/, "culture"],
      [/business|econom/, "business"],
    ]),
  /**
   * Discovers article URLs from Knowable's public RSS endpoints. The top-level
   * feed only exposes the latest items, so section-specific search RSS pages are
   * paged until they plateau. Homepage topic search RSS pages (`pub_topic`) are
   * paged too, catching articles that the section feeds miss. Candidates are
   * still validated against `articleUrlPattern` and `articleUrlFilter` by discovery.
   * Section search RSS pages request `pageSize=100`, returning up to 100 items
   * per page instead of the default 20.
   */
  urlExtractor: knowableUrlExtractor,
  /**
   * Knowable's PB-hosted article pages embed donation CTAs, leftover Froala
   * editor menus and related-content rails inside (or around) the article
   * body. Strip them before extraction so the harvest keeps the real prose and
   * the article portrait while dropping the noise the user complained about:
   *
   *   - `promo-article` — in-body "Donate today" / "Support Knowable" CTAs
   *     (`promo-article-donate`, `promo-article-dark`).
   *   - `layout-mode-menu` — an un-hydrated Froala "layout menu" rendered on the
   *     live article pages as `article-layout-mode-menu` (comic pages use
   *     `comic-layout-mode-menu`). Its `<h4>LAYOUT MENU</h4>` heading leaked into
   *     the body as harvested prose, and its `<select><option>` template text
   *     ("Some Placeholder Text", "CREDIT: NAME", "Institution Name") plus lazy
   *     `placeholder_img.jpg` stand-ins otherwise rode along. Matching is a class
   *     SUBSTRING, so this single keyword drops both the `article-` and `comic-`
   *     variants.
   *   - `ymal` / `more-from` — "You may also like" and "More From" related-
   *     article rails (other articles' thumbnails, not this article's imagery).
   *   - `deep-dive` — the trailing "TAKE A DEEPER DIVE | Explore Related
   *     Scholarly Articles …" citation rail (`<section class="deep-dive">` with a
   *     `<div class="deep-dive-header">`). It lists OTHER journal articles' titles
   *     and abstracts and sits AFTER the real body (outside the `.fr-view`
   *     container), so dropping it removes the boilerplate the user complained
   *     about without touching prose. Matching is a class SUBSTRING, so the one
   *     `deep-dive` keyword also covers the nested `deep-dive-header`.
   *   - `article-doi` — the article's own visible DOI citation string
   *     (`<div class="article-doi">10.1146/knowable-…</div>`) rendered next to the
   *     deep-dive rail. The same DOI also appears in a `<head>` `<meta
   *     name="dc.identifier">`, but that lives outside the harvested body and is
   *     not extracted.
   *   - `site-header` / `site-footer` / `mobile-nav` — page chrome carrying the
   *     header/footer "DONATE" links.
   *
   * Note: matching is a class/id SUBSTRING test on block containers, so
   * `article-sidebar` is intentionally NOT listed — it would also match
   * `article-sidebar-img`, which holds the real article portrait we keep.
   * `deep-dive` and `article-doi` are likewise narrow enough not to collide with
   * any legitimate body class (verified by re-extraction: the real prose and the
   * `/docserver/` imagery survive).
   */
  cleanup: {
    dropClassKeywords: [
      "promo-article",
      "layout-mode-menu",
      "ymal",
      "more-from",
      "deep-dive",
      "article-doi",
      "site-header",
      "site-footer",
      "mobile-nav",
    ],
  },
};

export default knowable;
