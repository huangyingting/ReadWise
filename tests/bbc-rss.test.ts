/**
 * Tests for the lightweight RSS URL parser.
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

const articleUrl = (id: string) => `https://www.bbc.com/news/articles/${id}`;

function assertIncludesUrl(urls: string[], url: string, message: string) {
  assert.ok(urls.includes(url), message);
}

// ---------------------------------------------------------------------------
// parseRssUrls tests
// ---------------------------------------------------------------------------

test("parseRssUrls: extracts URLs from <link> and permalink <guid>", () => {
  const urls = parseRssUrls(WORLD_FEED);
  // homepage <link> may also be included; article links must be present
  assertIncludesUrl(urls, articleUrl("c1111111111"), "article 1 present");
  assertIncludesUrl(urls, articleUrl("c2222222222"), "article 2 present");
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
  assertIncludesUrl(urls, articleUrl("cVALID00001"), "link element kept");
});

test("parseRssUrls: handles empty / malformed feed gracefully", () => {
  const urls = parseRssUrls("<not-rss/>");
  assert.deepEqual(urls, []);
});

test("parseRssUrls: multiple feeds merged and deduplicated across feeds", () => {
  const fromWorld = parseRssUrls(WORLD_FEED);
  const fromTech = parseRssUrls(TECH_FEED);
  const combined = [...new Set([...fromWorld, ...fromTech])];
  assertIncludesUrl(combined, articleUrl("c1111111111"), "world feed story included");
  assertIncludesUrl(combined, articleUrl("c3333333333"), "tech feed story included");
});
