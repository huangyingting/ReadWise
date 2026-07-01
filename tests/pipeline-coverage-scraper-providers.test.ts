process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

function sitemap(urls: string[]): string {
  return `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;
}

function rss(urls: string[]): string {
  return `<rss><channel>${urls.map((url) => `<item><link>${url}</link></item>`).join("")}</channel></rss>`;
}

test("BBC article URL helper rejects live/chrome URLs and category rules map sections", async () => {
  const bbc = (await import("@/lib/scraper/providers/bbc")).default;
  const { isBbcNewsArticleUrl } = await import("@/lib/scraper/providers/bbc");

  assert.equal(isBbcNewsArticleUrl("https://www.bbc.com/news/live/c1234567890"), false);
  assert.equal(isBbcNewsArticleUrl("https://www.bbc.com/news/world-us-canada-123456"), true);
  assert.equal(bbc.categoryFor?.(new URL("https://www.bbc.com/news/science-environment-123456"), null), "science");
  assert.equal(bbc.categoryFor?.(new URL("https://www.bbc.com/news/articles/c1"), "Technology"), "tech");
});

test("ProPublica extractor sorts daily sitemaps, skips bad children, and degrades on root failure", async () => {
  const propublica = (await import("@/lib/scraper/providers/propublica")).default;
  assert.ok(propublica.urlExtractor);

  const articleOld = "https://www.propublica.org/article/older-investigation";
  const articleNew = "https://www.propublica.org/article/newer-investigation";
  const dailyOld = "https://www.propublica.org/sitemap.xml?yyyy=2025&mm=12&dd=31";
  const dailyNew = "https://www.propublica.org/sitemap.xml?yyyy=2026&mm=01&dd=01";
  const calls: string[] = [];
  const urls = await propublica.urlExtractor({
    limit: 5,
    fetch: async (url) => {
      calls.push(url);
      if (url === "https://www.propublica.org/sitemap.xml") {
        return sitemap(["not a url", dailyOld, dailyNew]);
      }
      if (url === dailyNew) throw new Error("blocked child");
      if (url === dailyOld) return sitemap([articleOld, articleOld, articleNew]);
      return "";
    },
  });

  assert.deepEqual(urls, [articleOld, articleNew]);
  assert.deepEqual(calls.slice(0, 3), [
    "https://www.propublica.org/sitemap.xml",
    dailyNew,
    dailyOld,
  ]);
  assert.deepEqual(
    await propublica.urlExtractor({ limit: 5, fetch: async () => { throw new Error("down"); } }),
    [],
  );
});

test("Grist extractor falls back to RSS when sitemaps are unavailable or empty", async () => {
  const grist = (await import("@/lib/scraper/providers/grist")).default;
  assert.ok(grist.urlExtractor);

  const rssArticle = "https://grist.org/extreme-weather/europe-heat-wave-adaptation-plans/";
  const fallback = await grist.urlExtractor({
    limit: 3,
    fetch: async (url) => {
      if (url === "https://grist.org/sitemap_index.xml") throw new Error("sitemap down");
      if (url === "https://grist.org/feed/") return rss([rssArticle]);
      return "";
    },
  });
  assert.deepEqual(fallback, [rssArticle]);

  const childFailure = await grist.urlExtractor({
    limit: 3,
    fetch: async (url) => {
      if (url === "https://grist.org/sitemap_index.xml") {
        return sitemap(["https://grist.org/post-sitemap2.xml"]);
      }
      if (url === "https://grist.org/post-sitemap2.xml") throw new Error("child down");
      if (url === "https://grist.org/feed/") return rss([rssArticle]);
      return "";
    },
  });
  assert.deepEqual(childFailure, [rssArticle]);

  const fromSitemap = await grist.urlExtractor({
    limit: 5,
    fetch: async (url) => {
      if (url === "https://grist.org/sitemap_index.xml") {
        return sitemap([
          "https://grist.org/post-sitemap.xml",
          "https://grist.org/post-sitemap3.xml",
          "not a url",
        ]);
      }
      if (url === "https://grist.org/post-sitemap3.xml") {
        return sitemap(["https://grist.org/accountability/clean-water-investigation/"]);
      }
      if (url === "https://grist.org/post-sitemap.xml") {
        return sitemap([
          "https://grist.org/extreme-weather/heat-plans/",
          "https://grist.org/extreme-weather/heat-plans/",
        ]);
      }
      return "";
    },
  });
  assert.deepEqual(fromSitemap, [
    "https://grist.org/accountability/clean-water-investigation/",
    "https://grist.org/extreme-weather/heat-plans/",
  ]);
  assert.equal(grist.articleUrlFilter?.("https://grist.org/updates/grist-hires-reporter/"), false);
  assert.equal(
    grist.categoryFor?.(new URL("https://grist.org/accountability/clean-water-investigation/"), null),
    "politics",
  );
});

test("The Conversation extractor keeps English archive sitemaps and skips failing years", async () => {
  const provider = (await import("@/lib/scraper/providers/theconversation")).default;
  assert.ok(provider.urlExtractor);

  const usArchive = "https://theconversation.com/us/sitemap_archive_2026.xml";
  const ukArchive = "https://theconversation.com/uk/sitemap_archive_2025.xml";
  const article = "https://theconversation.com/example-research-story-123456";
  const result = await provider.urlExtractor({
    limit: 10,
    fetch: async (url) => {
      if (url === "https://theconversation.com/sitemap.xml") {
        return sitemap([
          "::::",
          "https://theconversation.com/fr/sitemap_archive_2026.xml",
          ukArchive,
          usArchive,
        ]);
      }
      if (url === usArchive) throw new Error("archive blocked");
      if (url === ukArchive) return sitemap([article, article]);
      return "";
    },
  });

  assert.deepEqual(result, [article]);
  assert.deepEqual(
    await provider.urlExtractor({ limit: 1, fetch: async () => { throw new Error("root down"); } }),
    [],
  );
});

test("Noema extractor combines sitemap, RSS, and topic archives while tolerating failures", async () => {
  const noema = (await import("@/lib/scraper/providers/noema")).default;
  assert.ok(noema.urlExtractor);

  const fromSitemap = "https://www.noemamag.com/future-of-cities/";
  const fromRss = "https://www.noemamag.com/essay-on-capitalism/";
  const fromTopic = "https://www.noemamag.com/digital-society/";
  const result = await noema.urlExtractor({
    limit: 10,
    fetch: async (url) => {
      if (url === "https://www.noemamag.com/sitemap_index.xml") {
        return sitemap(["bad:url", "https://www.noemamag.com/wpm-article-sitemap.xml"]);
      }
      if (url === "https://www.noemamag.com/wpm-article-sitemap.xml") {
        return sitemap([fromSitemap]);
      }
      if (url.includes("feed=noemarss&paged=1")) return rss([fromRss]);
      if (url.includes("feed=noemarss&paged=2")) throw new Error("rss page down");
      if (url === noema.seeds[0]) {
        return `<a href="${fromTopic}">Topic</a><a href="http://[::1">bad</a>`;
      }
      throw new Error("remaining topic unavailable");
    },
  });

  assert.deepEqual(result, [fromSitemap, fromRss, fromTopic]);
});

test("Noema extractor stops on repeated empty RSS/topic pages and skips blocked child sitemaps", async () => {
  const noema = (await import("@/lib/scraper/providers/noema")).default;
  assert.ok(noema.urlExtractor);

  const result = await noema.urlExtractor({
    limit: 10,
    fetch: async (url) => {
      if (url === "https://www.noemamag.com/sitemap_index.xml") {
        return sitemap(["bad url", "https://www.noemamag.com/wpm-article-sitemap2.xml"]);
      }
      if (url === "https://www.noemamag.com/wpm-article-sitemap2.xml") {
        throw new Error("blocked child sitemap");
      }
      if (url.includes("feed=noemarss")) return rss([]);
      if (url === noema.seeds[0]) return "<p>No article links</p>";
      if (url.includes("current_page=2")) return "<p>Still empty</p>";
      throw new Error("stop remaining seeds");
    },
  });

  assert.deepEqual(result, []);
});

test("National Geographic extractor harvests hubmore pages and then sitemap URLs", async () => {
  const natgeo = (await import("@/lib/scraper/providers/natgeo")).default;
  assert.ok(natgeo.urlExtractor);

  const seedArticle = "https://www.nationalgeographic.com/science/article/space-rocks";
  const hubmoreArticle = "https://www.nationalgeographic.com/animals/article/blue-whales";
  const sitemapArticle = "https://www.nationalgeographic.com/history/article/ancient-city";
  const result = await natgeo.urlExtractor({
    limit: 5,
    fetch: async (url) => {
      if (url === natgeo.seeds[0]) {
        return `
          <a href="${seedArticle}?cmp=abc#frag">Seed</a>
          <a href="/pages/topic/latest-stories?hubmore=true">More</a>
          <a href="/pages/topic/empty?hubmore=true">Empty more</a>
          <a href="http://[::1?hubmore=true">Bad more</a>
          <a href="http://[::1">Bad</a>
        `;
      }
      if (url.includes("hubmore=true") && url.includes("page=1")) {
        if (url.includes("/empty")) return "<p>No links</p>";
        return `<a href="${hubmoreArticle}">Hubmore</a>`;
      }
      if (url.includes("hubmore=true") && url.includes("page=2")) {
        if (url.includes("/empty")) return "<p>Still no links</p>";
        throw new Error("hubmore page failed");
      }
      if (url === "https://www.nationalgeographic.com/sitemaps/sitemap.xml") {
        return sitemap(["https://www.nationalgeographic.com/sitemaps/articles.xml"]);
      }
      if (url === "https://www.nationalgeographic.com/sitemaps/articles.xml") {
        return sitemap([sitemapArticle]);
      }
      throw new Error("seed unavailable");
    },
  });

  assert.deepEqual(result, [seedArticle, hubmoreArticle, sitemapArticle]);
  assert.equal(natgeo.articleUrlFilter?.("not a url"), false);
  assert.equal(
    natgeo.articleUrlFilter?.("https://www.nationalgeographic.com/travel/article/legacy_blog_post"),
    false,
  );
  assert.equal(
    natgeo.categoryFor?.(new URL("https://www.nationalgeographic.com/animals/article/blue-whales"), null),
    "animals",
  );
});

test("National Geographic extractor skips unavailable sitemaps without aborting discovery", async () => {
  const natgeo = (await import("@/lib/scraper/providers/natgeo")).default;
  assert.ok(natgeo.urlExtractor);

  const noIndex = await natgeo.urlExtractor({
    limit: 2,
    fetch: async (url) => {
      if (url === "https://www.nationalgeographic.com/sitemaps/sitemap.xml") {
        throw new Error("index unavailable");
      }
      throw new Error(`seed unavailable: ${url}`);
    },
  });
  assert.deepEqual(noIndex, []);

  const childDown = await natgeo.urlExtractor({
    limit: 2,
    fetch: async (url) => {
      if (url === "https://www.nationalgeographic.com/sitemaps/sitemap.xml") {
        return sitemap(["https://www.nationalgeographic.com/sitemaps/articles.xml"]);
      }
      if (url === "https://www.nationalgeographic.com/sitemaps/articles.xml") {
        throw new Error("child unavailable");
      }
      throw new Error(`seed unavailable: ${url}`);
    },
  });
  assert.deepEqual(childDown, []);
});

test("Smithsonian extractor respects year/category archive filters and pagination failures", async () => {
  const { createSmithsonianUrlExtractor } = await import("@/lib/scraper/providers/smithsonian");
  const extractor = createSmithsonianUrlExtractor({
    sinceYear: 2025,
    includeCategoryArchives: true,
    categoryVisibleOnly: true,
    excludeSections: ["smart-news"],
  });
  assert.ok(extractor);

  const sitemapArticle = "https://www.smithsonianmag.com/history/valid-story-180000001/";
  const categoryVisible = "https://www.smithsonianmag.com/history/category-story-180000002/";
  const categoryOld = "https://www.smithsonianmag.com/history/old-story-180000003/";
  const result = await extractor({
    limit: 10,
    fetch: async (url) => {
      if (url === "https://www.smithsonianmag.com/sitemap.xml") {
        return sitemap([
          "https://www.smithsonianmag.com/sitemap-articles-2027-01.xml",
          "https://www.smithsonianmag.com/sitemap-articles-2026-01.xml",
          "https://www.smithsonianmag.com/sitemap-articles-2024-01.xml",
        ]);
      }
      if (url.endsWith("sitemap-articles-2027-01.xml")) {
        throw new Error("newest sitemap blocked");
      }
      if (url.endsWith("sitemap-articles-2026-01.xml")) {
        return sitemap([
          "http://[::1",
          sitemapArticle,
          categoryVisible,
          "https://www.smithsonianmag.com/smart-news/skipped-180000004/",
        ]);
      }
      if (url === "https://www.smithsonianmag.com/category/science-nature/") {
        return `<a href="${categoryVisible}">visible</a><a href="${categoryOld}">old</a><a href="?page=2">2</a>`;
      }
      if (url === "https://www.smithsonianmag.com/category/science-nature/?page=2") {
        throw new Error("page blocked");
      }
      throw new Error("other categories unavailable");
    },
  });

  assert.deepEqual(result, [sitemapArticle, categoryVisible]);
});

test("Smithsonian extractor handles sitemap root failures and loose category archives", async () => {
  const { createSmithsonianUrlExtractor } = await import("@/lib/scraper/providers/smithsonian");
  const noArchiveExtractor = createSmithsonianUrlExtractor();
  assert.deepEqual(
    await noArchiveExtractor!({ limit: 5, fetch: async () => { throw new Error("root down"); } }),
    [],
  );

  const archiveExtractor = createSmithsonianUrlExtractor({ includeCategoryArchives: true });
  const looseCategory = "https://www.smithsonianmag.com/travel/archive-only-180000005/";
  const result = await archiveExtractor!({
    limit: 5,
    fetch: async (url) => {
      if (url === "https://www.smithsonianmag.com/sitemap.xml") return sitemap([]);
      if (url === "https://www.smithsonianmag.com/category/science-nature/") {
        return `<a href="${looseCategory}">Archive only</a>`;
      }
      throw new Error("remaining category unavailable");
    },
  });
  assert.deepEqual(result, [looseCategory]);
});

test("Smithsonian provider helpers paginate, filter chrome URLs, and categorize sections", async () => {
  const smithsonian = (await import("@/lib/scraper/providers/smithsonian")).default;

  assert.equal(
    smithsonian.paginateSeed?.("https://www.smithsonianmag.com/category/history/", 3),
    "https://www.smithsonianmag.com/category/history/?page=3",
  );
  assert.equal(
    smithsonian.articleUrlFilter?.("https://www.smithsonianmag.com/category/history/"),
    false,
  );
  assert.equal(
    smithsonian.categoryFor?.(
      new URL("https://www.smithsonianmag.com/innovation/example-180000001/"),
      null,
    ),
    "tech",
  );
});

test("Technology Review extractor walks robots sitemaps, WP API, RSS, and topic HTML", async () => {
  const provider = (await import("@/lib/scraper/providers/technologyreview")).default;
  assert.ok(provider.urlExtractor);

  const fromSitemap =
    "https://www.technologyreview.com/2026/06/23/123456/archive-story/";
  const fromWp =
    "https://www.technologyreview.com/2026/06/24/123457/wp-story/";
  const fromRss =
    "https://www.technologyreview.com/2026/06/25/123458/rss-story/";
  const fromTopic =
    "https://www.technologyreview.com/2026/06/26/123459/topic-story/";
  const result = await provider.urlExtractor({
    limit: 20,
    fetch: async (url) => {
      if (url === "https://www.technologyreview.com/robots.txt") {
        throw new Error("robots unavailable");
      }
      if (url === "https://www.technologyreview.com/sitemap.xml") {
        return sitemap([
          "::::",
          fromSitemap,
          "https://www.technologyreview.com/sitemap-index-1.xml",
          "https://www.technologyreview.com/sitemap-2.xml",
        ]);
      }
      if (url === "https://www.technologyreview.com/news-sitemap.xml") return sitemap([]);
      if (url === "https://www.technologyreview.com/sitemap-index-1.xml") {
        return sitemap(["https://www.technologyreview.com/sitemap-3.xml"]);
      }
      if (url === "https://www.technologyreview.com/sitemap-2.xml") {
        throw new Error("content sitemap unavailable");
      }
      if (url === "https://www.technologyreview.com/sitemap-3.xml") return sitemap([fromSitemap]);
      if (url.includes("/wp-json/wp/v2/posts") && url.includes("page=1")) {
        return JSON.stringify([
          { link: fromWp },
          { url: "http://[::1" },
          { url: "https://www.technologyreview.com/topic/ai/" },
        ]);
      }
      if (url.includes("/wp-json/wp/v2/posts") && url.includes("page=2")) return "not json";
      if (url.endsWith("/feed/")) return rss([fromRss]);
      if (url === provider.seeds[0]) return `<a href="${fromTopic}">Topic story</a>`;
      throw new Error("supplementary topic unavailable");
    },
  });

  assert.deepEqual(result, [fromSitemap, fromWp, fromRss, fromTopic]);
});

test("Technology Review extractor handles robots sitemap hints and API failures", async () => {
  const provider = (await import("@/lib/scraper/providers/technologyreview")).default;
  assert.ok(provider.urlExtractor);

  const fromRobots =
    "https://www.technologyreview.com/2026/06/27/123460/robots-story/";
  const result = await provider.urlExtractor({
    limit: 20,
    fetch: async (url) => {
      if (url === "https://www.technologyreview.com/robots.txt") {
        return [
          "Sitemap: not-a-url",
          "Sitemap: https://www.technologyreview.com/news-sitemap.xml",
        ].join("\n");
      }
      if (url === "https://www.technologyreview.com/sitemap.xml") return sitemap([]);
      if (url === "https://www.technologyreview.com/news-sitemap.xml") return sitemap([fromRobots]);
      if (url.includes("/wp-json/wp/v2/posts")) throw new Error("api unavailable");
      if (url.endsWith("/feed/")) return rss([]);
      throw new Error("topic unavailable");
    },
  });

  assert.deepEqual(result, [fromRobots]);
});
