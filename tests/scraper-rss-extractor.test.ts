/**
 * Tests for the shared RSS URL extractor and the RSS-based discovery wiring
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

// ---------------------------------------------------------------------------
// Per-provider discovery integration (RSS feeds with valid + junk URLs)
// ---------------------------------------------------------------------------

test("noema discovery: returns only pattern-passing article URLs from paginated RSS", async () => {
  const noema = getProvider("noema")!;
  const feedUrls = Array.from(
    { length: 30 },
    (_, i) => `https://www.noemamag.com/?feed=noemarss&paged=${i + 1}`,
  );
  const feedMap: Record<string, string> = {
    [feedUrls[0]!]: makeFeed([
      "https://www.noemamag.com/the-philosophy-of-networks/",
      // junk: topic index + author → must be filtered out
      "https://www.noemamag.com/article-topic/technology/",
      "https://www.noemamag.com/author/ada-lovelace/",
    ]),
    [feedUrls.at(-1)!]: makeFeed([
      "https://www.noemamag.com/future-of-democracy/",
    ]),
  };
  const fetchedFeeds: string[] = [];

  const urls = await discoverProviderUrls(noema, 20, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async (url: string) => {
      fetchedFeeds.push(url);
      return feedMap[url] ?? "<rss><channel></channel></rss>";
    },
  });

  assert.deepEqual(fetchedFeeds, feedUrls);
  assert.deepEqual(urls.sort(), [
    "https://www.noemamag.com/future-of-democracy/",
    "https://www.noemamag.com/the-philosophy-of-networks/",
  ]);
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
