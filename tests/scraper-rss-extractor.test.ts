/**
 * Tests for the shared RSS/sitemap URL extractors and the discovery wiring
 * of the nautilus / noema / technologyreview / undark / knowable providers.
 *
 * No real network — all feeds are served from fixture XML via a mocked
 * `ctx.fetch` / injected `extractorFetch`.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rssUrlExtractor,
  sitemapUrlExtractor,
} from "@/lib/scraper/providers/shared";
import { createSmithsonianProvider } from "@/lib/scraper/providers/smithsonian";
import { discoverProviderUrls } from "@/lib/scraper/discovery";
import { getProvider } from "@/lib/scraper/providers";
import type { Provider } from "@/lib/scraper/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal RSS 2.0 feed whose items link to the given URLs. */
function makeFeed(links: string[]): string {
  const items = links
    .map(
      (link) =>
        `<item><title>x</title><link>${link}</link><guid isPermaLink="true">${link}</guid></item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test</title>
${items}
</channel></rss>`;
}

function makeSitemap(locs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join("\n")}
</urlset>`;
}

function makeSitemapIndex(locs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`).join("\n")}
</sitemapindex>`;
}

function makeWordPressPosts(urls: string[], found = urls.length): string {
  return JSON.stringify({
    found,
    posts: urls.map((URL) => ({ URL })),
  });
}

function makeCategoryPage(links: string[], pageLinks: string[] = []): string {
  return `<html><body>
    ${links.map((link) => `<a href="${link}">article</a>`).join("\n")}
    ${pageLinks.map((link) => `<a href="${link}">page</a>`).join("\n")}
  </body></html>`;
}

/**
 * Runs a provider through real discovery using a feed-URL → XML map for the
 * injected extractor fetch. Returns the validated, pattern-passing URLs.
 */
function discoverWithFeeds(
  provider: Provider,
  feedMap: Record<string, string>,
  limit = 20,
): Promise<string[]> {
  return discoverProviderUrls(provider, limit, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async (url: string) =>
      feedMap[url] ?? "<rss><channel></channel></rss>",
  });
}

// ---------------------------------------------------------------------------
// rssUrlExtractor unit tests
// ---------------------------------------------------------------------------

test("rssUrlExtractor: returns article URLs parsed from a single feed", async () => {
  const extractor = rssUrlExtractor(["https://feed.test/rss"]);
  const xml = makeFeed([
    "https://example.com/a",
    "https://example.com/b",
  ]);
  const urls = await extractor({ limit: 10, fetch: async () => xml });
  assert.deepEqual(urls, ["https://example.com/a", "https://example.com/b"]);
});

test("rssUrlExtractor: deduplicates URLs across feeds", async () => {
  const extractor = rssUrlExtractor([
    "https://feed.test/one",
    "https://feed.test/two",
  ]);
  const feedMap: Record<string, string> = {
    "https://feed.test/one": makeFeed(["https://example.com/dup", "https://example.com/x"]),
    "https://feed.test/two": makeFeed(["https://example.com/dup", "https://example.com/y"]),
  };
  const urls = await extractor({
    limit: 10,
    fetch: async (url) => feedMap[url] ?? "",
  });
  assert.deepEqual(urls, [
    "https://example.com/dup",
    "https://example.com/x",
    "https://example.com/y",
  ]);
});

test("rssUrlExtractor: skips a feed that throws and keeps the rest", async () => {
  const extractor = rssUrlExtractor([
    "https://feed.test/bad",
    "https://feed.test/good",
  ]);
  const urls = await extractor({
    limit: 10,
    fetch: async (url) => {
      if (url.endsWith("/bad")) throw new Error("boom");
      return makeFeed(["https://example.com/ok"]);
    },
  });
  assert.deepEqual(urls, ["https://example.com/ok"]);
});

test("rssUrlExtractor: returns empty array when every feed throws", async () => {
  const extractor = rssUrlExtractor(["https://feed.test/a", "https://feed.test/b"]);
  const urls = await extractor({
    limit: 10,
    fetch: async () => {
      throw new Error("network down");
    },
  });
  assert.deepEqual(urls, []);
});

test("rssUrlExtractor: stops fetching feeds once 2x limit candidates collected", async () => {
  let fetchCount = 0;
  const extractor = rssUrlExtractor([
    "https://feed.test/1",
    "https://feed.test/2",
    "https://feed.test/3",
  ]);
  const urls = await extractor({
    limit: 5,
    fetch: async () => {
      fetchCount++;
      const links = Array.from(
        { length: 10 },
        (_, i) => `https://example.com/f${fetchCount}-${i}`,
      );
      return makeFeed(links);
    },
  });

  // limit=5 → cap at 2×5=10 → first feed already yields 10 → only 1 fetch
  assert.equal(fetchCount, 1);
  assert.equal(urls.length, 10);
});

test("sitemapUrlExtractor: fetches filtered child sitemaps and deduplicates URLs", async () => {
  const extractor = sitemapUrlExtractor("https://example.com/sitemap.xml", {
    sitemapUrlFilter: (url) => url.includes("articles"),
  });
  const fetched: string[] = [];
  const sitemapMap: Record<string, string> = {
    "https://example.com/sitemap.xml": makeSitemapIndex([
      "https://example.com/sitemap-pages.xml",
      "https://example.com/sitemap-articles-2026-06.xml",
      "https://example.com/sitemap-articles-2026-05.xml",
    ]),
    "https://example.com/sitemap-articles-2026-06.xml": makeSitemap([
      "https://example.com/a",
      "https://example.com/b",
    ]),
    "https://example.com/sitemap-articles-2026-05.xml": makeSitemap([
      "https://example.com/b",
      "https://example.com/c",
    ]),
  };

  const urls = await extractor({
    limit: 10,
    fetch: async (url) => {
      fetched.push(url);
      return sitemapMap[url] ?? makeSitemap([]);
    },
  });

  assert.deepEqual(urls, [
    "https://example.com/a",
    "https://example.com/b",
    "https://example.com/c",
  ]);
  assert.deepEqual(fetched, [
    "https://example.com/sitemap.xml",
    "https://example.com/sitemap-articles-2026-06.xml",
    "https://example.com/sitemap-articles-2026-05.xml",
  ]);
});

test("smithsonian discovery: can filter monthly sitemaps by year and excluded sections", async () => {
  const provider = createSmithsonianProvider({
    sinceYear: 2010,
    excludeSections: ["smart-news"],
  });
  const feedMap: Record<string, string> = {
    "https://www.smithsonianmag.com/sitemap.xml": makeSitemapIndex([
      "https://www.smithsonianmag.com/sitemap-articles-2009-12.xml",
      "https://www.smithsonianmag.com/sitemap-articles-2010-01.xml",
      "https://www.smithsonianmag.com/sitemap-articles-2026-06.xml",
    ]),
    "https://www.smithsonianmag.com/sitemap-articles-2009-12.xml": makeSitemap([
      "https://www.smithsonianmag.com/history/too-old-180000001/",
    ]),
    "https://www.smithsonianmag.com/sitemap-articles-2010-01.xml": makeSitemap([
      "https://www.smithsonianmag.com/history/kept-history-180000002/",
    ]),
    "https://www.smithsonianmag.com/sitemap-articles-2026-06.xml": makeSitemap([
      "https://www.smithsonianmag.com/smart-news/excluded-short-news-180000003/",
      "https://www.smithsonianmag.com/science-nature/kept-science-180000004/",
    ]),
  };
  const fetched: string[] = [];

  const urls = await discoverProviderUrls(provider, Number.POSITIVE_INFINITY, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async (url: string) => {
      fetched.push(url);
      return feedMap[url] ?? makeSitemap([]);
    },
  });

  assert.deepEqual(urls, [
    "https://www.smithsonianmag.com/science-nature/kept-science-180000004/",
    "https://www.smithsonianmag.com/history/kept-history-180000002/",
  ]);
  assert.equal(
    fetched.includes("https://www.smithsonianmag.com/sitemap-articles-2009-12.xml"),
    false,
  );
});

test("smithsonian discovery: category archive crawl follows deep pagination and can require sitemap visibility", async () => {
  const provider = createSmithsonianProvider({
    includeCategoryArchives: true,
    categoryVisibleOnly: true,
  });
  const categoryPageOne =
    "https://www.smithsonianmag.com/category/science-nature/";
  const categoryPageTwo =
    "https://www.smithsonianmag.com/category/science-nature/?page=2";
  const sitemapArticle =
    "https://www.smithsonianmag.com/science-nature/from-sitemap-and-category-180000005/";
  const categoryOnly =
    "https://www.smithsonianmag.com/science-nature/category-only-180000006/";
  const feedMap: Record<string, string> = {
    "https://www.smithsonianmag.com/sitemap.xml": makeSitemapIndex([
      "https://www.smithsonianmag.com/sitemap-articles-2026-06.xml",
    ]),
    "https://www.smithsonianmag.com/sitemap-articles-2026-06.xml": makeSitemap([
      sitemapArticle,
    ]),
    [categoryPageOne]: makeCategoryPage([], [categoryPageTwo]),
    [categoryPageTwo]: makeCategoryPage([sitemapArticle, categoryOnly]),
  };
  const fetched: string[] = [];

  const urls = await discoverProviderUrls(provider, Number.POSITIVE_INFINITY, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async (url: string) => {
      fetched.push(url);
      return feedMap[url] ?? makeCategoryPage([]);
    },
  });

  assert.deepEqual(urls, [sitemapArticle]);
  assert.ok(fetched.includes(categoryPageTwo));
  assert.equal(urls.includes(categoryOnly), false);
});

// ---------------------------------------------------------------------------
// Per-provider discovery integration (RSS feeds with valid + junk URLs)
// ---------------------------------------------------------------------------

test("noema discovery: uses article sitemaps plus paginated RSS until exhaustion", async () => {
  const noema = getProvider("noema")!;
  const feedUrls = Array.from({ length: 31 }, (_, i) =>
    `https://www.noemamag.com/?feed=noemarss&paged=${i + 1}`
  );
  const rssPageUrls = Array.from(
    { length: 29 },
    (_, i) => `https://www.noemamag.com/rss-page-${i + 3}/`,
  );
  const feedMap: Record<string, string> = {
    "https://www.noemamag.com/sitemap_index.xml": makeSitemapIndex([
      "https://www.noemamag.com/page-sitemap.xml",
      "https://www.noemamag.com/wpm-article-sitemap.xml",
      "https://www.noemamag.com/wpm-article-sitemap2.xml",
      "https://www.noemamag.com/wpm-article-topic-sitemap.xml",
    ]),
    "https://www.noemamag.com/wpm-article-sitemap.xml": makeSitemap([
      "https://www.noemamag.com/the-philosophy-of-networks/",
      // junk: topic index + author → must be filtered out by discovery
      "https://www.noemamag.com/article-topic/technology/",
      "https://www.noemamag.com/author/ada-lovelace/",
    ]),
    "https://www.noemamag.com/wpm-article-sitemap2.xml": makeSitemap([
      "https://www.noemamag.com/future-of-democracy/",
    ]),
  };
  for (const [i, feedUrl] of feedUrls.entries()) {
    if (i === 0) {
      feedMap[feedUrl] = makeFeed(["https://www.noemamag.com/the-philosophy-of-networks/"]);
    } else if (i === 1) {
      feedMap[feedUrl] = makeFeed(["https://www.noemamag.com/future-of-democracy/"]);
    } else {
      feedMap[feedUrl] = makeFeed([rssPageUrls[i - 2]!]);
    }
  }
  const fetchedFeeds: string[] = [];

  const urls = await discoverProviderUrls(noema, Number.POSITIVE_INFINITY, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async (url: string) => {
      fetchedFeeds.push(url);
      if (url === "https://www.noemamag.com/?feed=noemarss&paged=32") {
        throw new Error("rss exhausted");
      }
      return feedMap[url] ?? "<rss><channel></channel></rss>";
    },
  });

  assert.deepEqual(fetchedFeeds, [
    "https://www.noemamag.com/sitemap_index.xml",
    "https://www.noemamag.com/wpm-article-sitemap.xml",
    "https://www.noemamag.com/wpm-article-sitemap2.xml",
    ...feedUrls,
    "https://www.noemamag.com/?feed=noemarss&paged=32",
  ]);
  assert.ok(
    urls.includes("https://www.noemamag.com/rss-page-31/"),
    "RSS pagination must continue beyond the old 30-page cutoff",
  );
  assert.deepEqual(urls.sort(), [
    "https://www.noemamag.com/future-of-democracy/",
    ...rssPageUrls,
    "https://www.noemamag.com/the-philosophy-of-networks/",
  ].sort());
});

test("technologyreview discovery: returns only dated article URLs from RSS", async () => {
  const tr = getProvider("technologyreview")!;
  const feed = makeFeed([
    "https://www.technologyreview.com/2024/05/01/1091234/the-future-of-ai/",
    "https://www.technologyreview.com/2024/06/02/1095678/quantum-leap/",
    // junk: topic + author pages
    "https://www.technologyreview.com/topic/artificial-intelligence/",
    "https://www.technologyreview.com/author/jane-doe/",
  ]);
  const urls = await discoverWithFeeds(tr, {
    "https://www.technologyreview.com/feed/": feed,
  });
  assert.deepEqual(urls.sort(), [
    "https://www.technologyreview.com/2024/05/01/1091234/the-future-of-ai/",
    "https://www.technologyreview.com/2024/06/02/1095678/quantum-leap/",
  ]);
});

test("undark discovery: returns only dated article URLs from the public WordPress.com posts API", async () => {
  const undark = getProvider("undark")!;
  const urls = await discoverProviderUrls(undark, 20, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async (url) => {
      const parsed = new URL(url);
      assert.equal(
        `${parsed.origin}${parsed.pathname}`,
        "https://public-api.wordpress.com/rest/v1.1/sites/undark.org/posts/",
      );
      assert.equal(parsed.searchParams.get("status"), "publish");
      assert.equal(parsed.searchParams.get("type"), "post");
      return makeWordPressPosts([
        "https://undark.org/2024/03/10/the-science-of-sleep/",
        "https://undark.org/2024/04/22/climate-tipping-points/",
        // junk: tag + author
        "https://undark.org/tag/climate-change/",
        "https://undark.org/author/john-smith/",
      ]);
    },
  });

  assert.deepEqual(urls.sort(), [
    "https://undark.org/2024/03/10/the-science-of-sleep/",
    "https://undark.org/2024/04/22/climate-tipping-points/",
  ]);
});

test("undark discovery: paginates the public WordPress.com API for exhaustive discovery", async () => {
  const undark = getProvider("undark")!;
  const pageOne = Array.from(
    { length: 100 },
    (_, i) => `https://undark.org/2024/03/10/page-one-story-${i}/`,
  );
  const pageTwo = ["https://undark.org/2024/03/11/page-two-story/"];
  const fetchedPages: string[] = [];
  const urls = await discoverProviderUrls(undark, Number.POSITIVE_INFINITY, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async (url) => {
      const parsed = new URL(url);
      const page = parsed.searchParams.get("page") ?? "1";
      fetchedPages.push(page);
      return page === "1"
        ? makeWordPressPosts(pageOne, 101)
        : makeWordPressPosts(pageTwo, 101);
    },
  });

  assert.equal(urls.length, 101);
  assert.deepEqual(fetchedPages, ["1", "2"]);
  assert.equal(urls[0], pageOne[0]);
  assert.equal(urls.at(-1), pageTwo[0]);
});

test("undark discovery: falls back to RSS when the WordPress.com API fails", async () => {
  const undark = getProvider("undark")!;
  const feed = makeFeed([
    "https://undark.org/2024/03/10/the-science-of-sleep/",
    "https://undark.org/2024/04/22/climate-tipping-points/",
    // junk: tag + author
    "https://undark.org/tag/climate-change/",
    "https://undark.org/author/john-smith/",
  ]);
  const urls = await discoverProviderUrls(undark, 20, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async (url) => {
      if (url === "https://undark.org/feed/") return feed;
      throw new Error("api down");
    },
  });
  assert.deepEqual(urls.sort(), [
    "https://undark.org/2024/03/10/the-science-of-sleep/",
    "https://undark.org/2024/04/22/climate-tipping-points/",
  ]);
});

test("knowable discovery: returns only article URLs from RSS", async () => {
  const knowable = getProvider("knowable")!;
  const feed = makeFeed([
    "https://knowablemagazine.org/article/technology/2024/the-rise-of-robots/",
    "https://knowablemagazine.org/content/article/health/2024/gut-microbiome/",
    // junk: search + about
    "https://knowablemagazine.org/search?value1=x",
    "https://knowablemagazine.org/about/",
  ]);
  const urls = await discoverWithFeeds(knowable, {
    "https://knowablemagazine.org/rss": feed,
  });
  assert.deepEqual(urls.sort(), [
    "https://knowablemagazine.org/article/technology/2024/the-rise-of-robots/",
    "https://knowablemagazine.org/content/article/health/2024/gut-microbiome/",
  ]);
});

function knowableSearchFeedUrl(section: string, page = 1): string {
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

function knowableTopicFeedUrl(topic: string, page = 1): string {
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

test("knowable discovery: pages section RSS feeds beyond the latest feed", async () => {
  const knowable = getProvider("knowable")!;
  const recent = "https://knowablemagazine.org/content/article/technology/2026/example-recent/";
  const physicalOne =
    "https://knowablemagazine.org/content/article/physical-world/2024/example-archive-one/";
  const physicalTwo =
    "https://knowablemagazine.org/content/article/physical-world/2023/example-archive-two/";
  const mindOne = "https://knowablemagazine.org/content/article/mind/2022/example-mind/";
  const climateTopic =
    "https://knowablemagazine.org/content/article/food-environment/2021/example-climate-topic/";
  const fetched: string[] = [];
  const feedMap: Record<string, string> = {
    "https://knowablemagazine.org/rss": makeFeed([recent]),
    [knowableSearchFeedUrl("physical-world")]: makeFeed([
      recent,
      physicalOne,
      "https://knowablemagazine.org/search?value1=x",
    ]),
    [knowableSearchFeedUrl("physical-world", 2)]: makeFeed([physicalTwo]),
    [knowableSearchFeedUrl("mind")]: makeFeed([mindOne]),
    [knowableTopicFeedUrl("climate-change")]: makeFeed([climateTopic]),
  };

  const urls = await discoverProviderUrls(knowable, 10, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async (url) => {
      fetched.push(url);
      return feedMap[url] ?? makeFeed([]);
    },
  });

  assert.deepEqual(
    urls.sort(),
    [climateTopic, mindOne, physicalOne, physicalTwo, recent].sort(),
  );
  assert.ok(
    fetched.includes(knowableSearchFeedUrl("physical-world", 2)),
    "must continue past the first section RSS page",
  );
  assert.ok(
    fetched.includes(knowableSearchFeedUrl("health-disease")),
    "must cover the health-disease section that is absent from the old seeds",
  );
  assert.ok(
    fetched.includes(knowableSearchFeedUrl("mind")),
    "must cover the mind section that is absent from the old seeds",
  );
  assert.ok(urls.includes(climateTopic), "must include a unique article from a topic feed");
  assert.ok(
    fetched.includes(knowableTopicFeedUrl("climate-change")),
    "must fetch homepage topic RSS feeds",
  );
});

test("nautilus discovery: returns only article URLs from RSS", async () => {
  const nautilus = getProvider("nautilus")!;
  const feed = makeFeed([
    "https://nautil.us/the-hidden-life-of-trees-12345/",
    "https://nautil.us/why-time-flies-67890/",
    // junk: category + author pages (no trailing numeric id)
    "https://nautil.us/category/cosmos/",
    "https://nautil.us/author/someone/",
  ]);
  const urls = await discoverWithFeeds(nautilus, {
    "https://nautil.us/feed": feed,
  });

  assert.deepEqual(urls.sort(), [
    "https://nautil.us/the-hidden-life-of-trees-12345/",
    "https://nautil.us/why-time-flies-67890/",
  ]);
});

test("nautilus discovery: uses the public content sitemap index before RSS", async () => {
  const nautilus = getProvider("nautilus")!;
  const validRecent = "https://nautil.us/example-story-123456/";
  const validLegacy = "https://nautil.us/legacy-feature/";
  const validNested = "https://nautil.us/archive/feature-essay/";
  const fetched: string[] = [];
  const feedMap: Record<string, string> = {
    "https://nautil.us/sitemap-index-1.xml": makeSitemapIndex([
      "https://nautil.us/sitemap-1.xml",
      "https://nautil.us/image-sitemap-1.xml",
    ]),
    "https://nautil.us/sitemap-1.xml": makeSitemap([
      validRecent,
      validLegacy,
      validNested,
      "https://nautil.us/newsletter/example/",
      "https://nautil.us/category/cosmos/",
    ]),
    "https://nautil.us/image-sitemap-1.xml": makeSitemap([
      "https://nautil.us/wp-content/uploads/sites/70/image.jpg",
    ]),
    "https://nautil.us/feed": makeFeed(["https://nautil.us/rss-fallback-99999/"]),
  };

  const urls = await discoverProviderUrls(nautilus, 10, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async (url) => {
      fetched.push(url);
      if (url.includes("/wp-json/wp/v2/posts")) return JSON.stringify([]);
      return feedMap[url] ?? makeSitemap([]);
    },
  });

  assert.deepEqual(urls.sort(), [validLegacy, validNested, validRecent].sort());
  assert.ok(fetched.includes("https://nautil.us/sitemap-index-1.xml"));
  assert.ok(fetched.includes("https://nautil.us/sitemap-1.xml"));
  assert.equal(fetched.includes("https://nautil.us/image-sitemap-1.xml"), false);
  assert.equal(fetched.includes("https://nautil.us/feed"), false);
});

test("smithsonian discovery: returns article URLs from monthly article sitemaps", async () => {
  const smithsonian = getProvider("smithsonian")!;
  const fetched: string[] = [];
  const validOne =
    "https://www.smithsonianmag.com/smart-news/museum-finds-new-clue-180988001/";
  const validTwo =
    "https://www.smithsonianmag.com/history/archive-visit-new-questions-180988002/";
  const sitemapMap: Record<string, string> = {
    "https://www.smithsonianmag.com/sitemap.xml": makeSitemapIndex([
      "https://www.smithsonianmag.com/sitemap-pages.xml",
      "https://www.smithsonianmag.com/sitemap-news.xml",
      "https://www.smithsonianmag.com/sitemap-articles-2026-06.xml",
    ]),
    "https://www.smithsonianmag.com/sitemap-articles-2026-06.xml": makeSitemap([
      validOne,
      validTwo,
      "https://www.smithsonianmag.com/category/history/",
      "https://example.com/smart-news/offsite-180988003/",
    ]),
  };

  const urls = await discoverProviderUrls(smithsonian, 10, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async (url) => {
      fetched.push(url);
      return sitemapMap[url] ?? makeSitemap([]);
    },
  });

  assert.deepEqual(urls, [validOne, validTwo]);
  assert.deepEqual(fetched, [
    "https://www.smithsonianmag.com/sitemap.xml",
    "https://www.smithsonianmag.com/sitemap-articles-2026-06.xml",
  ]);
});

// ---------------------------------------------------------------------------
// nautilus API → RSS fallback
// ---------------------------------------------------------------------------

test("nautilus urlExtractor: falls back to RSS when the WP API returns nothing", async () => {
  const nautilus = getProvider("nautilus")!;
  const rssFeed = makeFeed(["https://nautil.us/fallback-article-99999/"]);
  const fetchFn = async (url: string) => {
    if (url === "https://nautil.us/feed") return rssFeed;
    // WP API: empty array of posts
    return JSON.stringify([]);
  };
  const urls = await nautilus.urlExtractor!({ limit: 10, fetch: fetchFn });
  assert.deepEqual(urls, ["https://nautil.us/fallback-article-99999/"]);
});

test("nautilus urlExtractor: uses the WP API when it returns results (no RSS)", async () => {
  const nautilus = getProvider("nautilus")!;
  let rssFetched = false;
  const fetchFn = async (url: string) => {
    if (url === "https://nautil.us/feed") {
      rssFetched = true;
      return makeFeed(["https://nautil.us/should-not-be-used-00000/"]);
    }
    return JSON.stringify([{ link: "https://nautil.us/from-wp-api-12345/" }]);
  };
  const urls = await nautilus.urlExtractor!({ limit: 10, fetch: fetchFn });
  assert.deepEqual(urls, ["https://nautil.us/from-wp-api-12345/"]);
  assert.equal(rssFetched, false, "RSS feed must not be fetched when API succeeds");
});
