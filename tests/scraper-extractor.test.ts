/**
 * Tests for urlExtractor integration in discoverProviderUrls (#360/#380).
 *
 * All tests use fully injected deps — no real network or DB is touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module mocks (must be set before any import of the modules under test)
// ---------------------------------------------------------------------------

before(() => {
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
  mock.module("@/lib/content-sources", {
    namedExports: {
      isProviderEnabled: async () => true,
      syncContentSources: async () => {},
    },
  });
  mock.module("@/lib/scraper/robots", {
    namedExports: {
      isUrlAllowed: async () => true,
    },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      findPublicLibraryArticleBySourceUrl: async () => null,
      PUBLIC_ARTICLE_CREATE_FIELDS: {},
    },
  });
  mock.module("@/lib/security/audit", {
    namedExports: { recordAuditFromRequest: async () => {} },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(overrides: Partial<import("@/lib/scraper/types").Provider> = {}) {
  return {
    key: "test-provider",
    name: "Test Provider",
    hostnames: ["test.example.com", "www.test.example.com"],
    seeds: ["https://test.example.com/news"],
    articleUrlPattern: /^https:\/\/(?:www\.)?test\.example\.com\/articles\/[a-z0-9-]+\/?$/i,
    defaultCategory: "world",
    ...overrides,
  } as import("@/lib/scraper/types").Provider;
}

const VALID_URL_1 = "https://test.example.com/articles/story-one";
const VALID_URL_2 = "https://test.example.com/articles/story-two";
const VALID_URL_3 = "https://test.example.com/articles/story-three";
const NON_PROVIDER_URL = "https://other.example.com/articles/story-one";
const FILTERED_URL = "https://test.example.com/video/something";

// ---------------------------------------------------------------------------
// discoverProviderUrls + urlExtractor
// ---------------------------------------------------------------------------

test("urlExtractor: disabled provider skips extractor entirely", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/index");

  let called = false;
  const provider = makeProvider({
    urlExtractor: async () => {
      called = true;
      return [VALID_URL_1];
    },
  });

  const result = await discoverProviderUrls(provider, 10, {
    isProviderEnabled: async () => false,
    isUrlAllowed: async () => true,
    extractorFetch: async () => "",
  });

  assert.deepEqual(result, []);
  assert.equal(called, false, "extractor must not be called when provider is disabled");
});

test("urlExtractor: deduplicates candidate URLs", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/index");

  const provider = makeProvider({
    urlExtractor: async () => [VALID_URL_1, VALID_URL_1, VALID_URL_1],
  });

  const result = await discoverProviderUrls(provider, 10, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async () => "",
  });

  assert.deepEqual(result, [VALID_URL_1]);
});

test("urlExtractor: filters URLs that don't belong to the provider", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/index");

  const provider = makeProvider({
    urlExtractor: async () => [NON_PROVIDER_URL, VALID_URL_1],
  });

  const result = await discoverProviderUrls(provider, 10, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async () => "",
  });

  assert.deepEqual(result, [VALID_URL_1]);
});

test("urlExtractor: filters URLs that don't match articleUrlPattern", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/index");

  // articleUrlPattern only matches /articles/… not /section/…
  const PATTERN_MISS = "https://test.example.com/section/politics";
  const provider = makeProvider({
    urlExtractor: async () => [PATTERN_MISS, VALID_URL_1],
  });

  const result = await discoverProviderUrls(provider, 10, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async () => "",
  });

  assert.deepEqual(result, [VALID_URL_1]);
});

test("urlExtractor: applies articleUrlFilter", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/index");

  const provider = makeProvider({
    // articleUrlFilter accepts only URLs that do NOT contain /video/
    articleUrlFilter: (url) => !url.includes("/video/"),
    urlExtractor: async () => [FILTERED_URL, VALID_URL_1],
  });

  const result = await discoverProviderUrls(provider, 10, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async () => "",
  });

  assert.deepEqual(result, [VALID_URL_1]);
});

test("urlExtractor: robots-disallowed URLs are excluded", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/index");

  const provider = makeProvider({
    urlExtractor: async () => [VALID_URL_1, VALID_URL_2],
  });

  // Disallow URL_2 via robots
  const result = await discoverProviderUrls(provider, 10, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async (url) => url !== VALID_URL_2,
    extractorFetch: async () => "",
  });

  assert.deepEqual(result, [VALID_URL_1]);
});

test("urlExtractor: throwing extractor degrades gracefully to empty list", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/index");

  const provider = makeProvider({
    urlExtractor: async () => {
      throw new Error("extractor blew up");
    },
  });

  const result = await discoverProviderUrls(provider, 10, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async () => "",
  });

  assert.deepEqual(result, []);
});

test("urlExtractor: extractor returning non-array-of-strings degrades gracefully", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/index");

  const provider = makeProvider({
    // Return some garbage mixed with valid URLs
    urlExtractor: async () => [VALID_URL_1, "", "not a url", VALID_URL_2],
  });

  const result = await discoverProviderUrls(provider, 10, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async () => "",
  });

  // Only the two valid URLs should survive
  assert.equal(result.length, 2);
  assert.ok(result.includes(VALID_URL_1));
  assert.ok(result.includes(VALID_URL_2));
});

test("urlExtractor: respects the limit", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/index");

  const provider = makeProvider({
    urlExtractor: async () => [VALID_URL_1, VALID_URL_2, VALID_URL_3],
  });

  const result = await discoverProviderUrls(provider, 2, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async () => "",
  });

  assert.equal(result.length, 2);
});

test("urlExtractor: strips #fragments from candidate URLs", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/index");

  const withFragment = VALID_URL_1 + "#section-2";
  const provider = makeProvider({
    urlExtractor: async () => [withFragment],
  });

  const result = await discoverProviderUrls(provider, 10, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    extractorFetch: async () => "",
  });

  assert.deepEqual(result, [VALID_URL_1]);
});

test("legacy seed-HTML path still works when no urlExtractor is defined", async () => {
  const { discoverProviderUrls } = await import("@/lib/scraper/index");

  const provider = makeProvider({
    // No urlExtractor — should fall back to seed HTML crawl
  });

  const seedHtml = `
    <a href="/articles/story-one">Story</a>
    <a href="/articles/story-two">Story 2</a>
  `;

  const result = await discoverProviderUrls(provider, 10, {
    isProviderEnabled: async () => true,
    isUrlAllowed: async () => true,
    fetchHtml: async () => seedHtml,
  });

  assert.equal(result.length, 2);
  assert.ok(result.includes(VALID_URL_1));
  assert.ok(result.includes(VALID_URL_2));
});
