/**
 * Tests for the BBC News RSS URL extractor (#361).
 * No real network — fixture XML is injected via the fetch parameter.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRssUrls } from "@/lib/scraper/rss";

// ---------------------------------------------------------------------------
// RSS XML fixtures
// ---------------------------------------------------------------------------

const WORLD_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BBC News - World</title>
    <link>https://www.bbc.co.uk/news/world</link>
    <item>
      <title>Story One</title>
      <link>https://www.bbc.com/news/articles/c1111111111</link>
      <guid isPermaLink="true">https://www.bbc.com/news/articles/c1111111111</guid>
    </item>
    <item>
      <title>Story Two</title>
      <link>https://www.bbc.com/news/articles/c2222222222</link>
      <guid isPermaLink="true">https://www.bbc.com/news/articles/c2222222222</guid>
    </item>
  </channel>
</rss>`;

const TECH_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BBC News - Technology</title>
    <link>https://www.bbc.co.uk/news/technology</link>
    <item>
      <title>Tech Story</title>
      <link>https://www.bbc.com/news/articles/c3333333333</link>
      <guid isPermaLink="true">https://www.bbc.com/news/articles/c3333333333</guid>
    </item>
  </channel>
</rss>`;

const FEED_WITH_DUPLICATES = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BBC News</title>
    <link>https://www.bbc.co.uk/news</link>
    <item>
      <link>https://www.bbc.com/news/articles/cDUP0000001</link>
      <guid isPermaLink="true">https://www.bbc.com/news/articles/cDUP0000001</guid>
    </item>
    <item>
      <link>https://www.bbc.com/news/articles/cDUP0000001</link>
      <guid isPermaLink="true">https://www.bbc.com/news/articles/cDUP0000001</guid>
    </item>
    <item>
      <link>https://www.bbc.com/news/articles/cDUP0000002</link>
    </item>
  </channel>
</rss>`;

const FEED_WITH_FRAGMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BBC News</title>
    <link>https://www.bbc.co.uk/news</link>
    <item>
      <link>https://www.bbc.com/news/articles/cFRAG000001?utm_source=rss#section</link>
      <guid isPermaLink="true">https://www.bbc.com/news/articles/cFRAG000001?utm_source=rss#section</guid>
    </item>
  </channel>
</rss>`;

const FEED_WITH_NON_PERMALINK_GUID = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>BBC News</title>
    <link>https://www.bbc.co.uk/news</link>
    <item>
      <link>https://www.bbc.com/news/articles/cVALID00001</link>
      <guid isPermaLink="false">urn:bbc:topic:12345</guid>
    </item>
  </channel>
</rss>`;

// ---------------------------------------------------------------------------
// parseRssUrls tests
// ---------------------------------------------------------------------------

test("parseRssUrls: extracts URLs from <link> and permalink <guid>", () => {
  const urls = parseRssUrls(WORLD_FEED);
  // homepage <link> may also be included; article links must be present
  assert.ok(urls.includes("https://www.bbc.com/news/articles/c1111111111"), "article 1 present");
  assert.ok(urls.includes("https://www.bbc.com/news/articles/c2222222222"), "article 2 present");
});

test("parseRssUrls: deduplicates URLs from <link> + <guid>", () => {
  const urls = parseRssUrls(FEED_WITH_DUPLICATES);
  const cDup1Count = urls.filter((u) => u.includes("cDUP0000001")).length;
  assert.equal(cDup1Count, 1, "duplicate URL should appear only once");
});

test("parseRssUrls: strips query strings and #fragments", () => {
  const urls = parseRssUrls(FEED_WITH_FRAGMENTS);
  const cleaned = urls.find((u) => u.includes("cFRAG000001"));
  assert.ok(cleaned, "URL should be present");
  assert.ok(!cleaned?.includes("?utm_source"), "query string stripped");
  assert.ok(!cleaned?.includes("#"), "fragment stripped");
});

test("parseRssUrls: skips <guid isPermaLink='false'> but keeps <link>", () => {
  const urls = parseRssUrls(FEED_WITH_NON_PERMALINK_GUID);
  // The non-permalink guid (urn:bbc:topic:12345) should not appear
  assert.ok(!urls.some((u) => u.includes("urn:bbc")), "non-permalink guid excluded");
  // But the <link> should still be collected
  assert.ok(urls.includes("https://www.bbc.com/news/articles/cVALID00001"), "link element kept");
});

test("parseRssUrls: handles empty / malformed feed gracefully", () => {
  const urls = parseRssUrls("<not-rss/>");
  assert.deepEqual(urls, []);
});

test("parseRssUrls: multiple feeds merged and deduplicated across feeds", () => {
  // Simulate merging two feeds (as the BBC extractor does)
  const fromWorld = parseRssUrls(WORLD_FEED);
  const fromTech = parseRssUrls(TECH_FEED);
  const combined = [...new Set([...fromWorld, ...fromTech])];
  assert.ok(combined.includes("https://www.bbc.com/news/articles/c1111111111"));
  assert.ok(combined.includes("https://www.bbc.com/news/articles/c3333333333"));
});

// ---------------------------------------------------------------------------
// BBC provider urlExtractor integration
// ---------------------------------------------------------------------------

test("BBC urlExtractor: returns article URLs from RSS feeds via injected fetch", async () => {
  const { getProvider } = await import("@/lib/scraper/providers");
  const bbc = getProvider("bbc");
  assert.ok(bbc?.urlExtractor, "BBC provider must have a urlExtractor");

  const feedMap: Record<string, string> = {
    "https://feeds.bbci.co.uk/news/world/rss.xml": WORLD_FEED,
    "https://feeds.bbci.co.uk/news/technology/rss.xml": TECH_FEED,
  };

  const mockFetch = async (url: string) => feedMap[url] ?? "<rss><channel></channel></rss>";

  const urls = await bbc!.urlExtractor!({ limit: 20, fetch: mockFetch });

  assert.ok(urls.includes("https://www.bbc.com/news/articles/c1111111111"), "world story included");
  assert.ok(urls.includes("https://www.bbc.com/news/articles/c3333333333"), "tech story included");
});

test("BBC urlExtractor: degrades gracefully when a feed fetch throws", async () => {
  const { getProvider } = await import("@/lib/scraper/providers");
  const bbc = getProvider("bbc");
  assert.ok(bbc?.urlExtractor);

  // All feeds throw — extractor should return empty array, not throw
  const result = await bbc!.urlExtractor!({
    limit: 10,
    fetch: async () => {
      throw new Error("network error");
    },
  });

  assert.deepEqual(result, []);
});

test("BBC urlExtractor: stops fetching feeds once 2× limit candidates collected", async () => {
  const { getProvider } = await import("@/lib/scraper/providers");
  const bbc = getProvider("bbc");
  assert.ok(bbc?.urlExtractor);

  let fetchCount = 0;
  // Each fake feed returns 10 article URLs
  const mockFetch = async (_url: string) => {
    fetchCount++;
    const items = Array.from(
      { length: 10 },
      (_, i) =>
        `<item><link>https://www.bbc.com/news/articles/c${fetchCount}${String(i).padStart(9, "0")}</link></item>`,
    ).join("\n");
    return `<rss><channel>${items}</channel></rss>`;
  };

  await bbc!.urlExtractor!({ limit: 5, fetch: mockFetch });

  // limit=5 → stop after 2×5=10 candidates → only 1 feed needed (returns 10 per feed)
  assert.ok(fetchCount <= 2, `too many feeds fetched: ${fetchCount}`);
});
