/**
 * Tests for the Nautilus WordPress REST API extractor (#362).
 * No real network — injectable fetch with fixture JSON.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchNautilusUrls,
  NAUTILUS_WP_API_BASE,
  NAUTILUS_WP_CATEGORY_MAP,
} from "@/lib/scraper/wp-api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePosts(count: number, startIndex = 1): Array<{ link: string }> {
  return Array.from({ length: count }, (_, i) => ({
    link: `https://nautil.us/article-title-${startIndex + i}00000/`,
  }));
}

// ---------------------------------------------------------------------------
// fetchNautilusUrls unit tests
// ---------------------------------------------------------------------------

test("fetchNautilusUrls: returns post links from a single page", async () => {
  const posts = makePosts(3);
  const mockFetch = async (_url: string) => JSON.stringify(posts);

  const urls = await fetchNautilusUrls(10, mockFetch);

  assert.equal(urls.length, 3);
  assert.ok(urls.every((u) => u.startsWith("https://nautil.us/")));
});

test("fetchNautilusUrls: paginates until limit×2 candidates reached", async () => {
  let page = 0;
  const mockFetch = async (url: string) => {
    assert.ok(url.includes(NAUTILUS_WP_API_BASE), "URL should use WP API base");
    page++;
    // Return 20 posts per page (matching PER_PAGE)
    return JSON.stringify(makePosts(20, page * 100));
  };

  const urls = await fetchNautilusUrls(5, mockFetch);

  // limit=5 → want 2×5=10 candidates → needs at least 1 page of 20 (overshoot is fine)
  assert.ok(urls.length >= 5, "should have at least 5 candidates");
});

test("fetchNautilusUrls: stops pagination when page returns fewer than per_page items", async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    if (callCount === 1) return JSON.stringify(makePosts(20));
    if (callCount === 2) return JSON.stringify(makePosts(5)); // partial page → last page
    return JSON.stringify([]); // should not be reached
  };

  const urls = await fetchNautilusUrls(100, mockFetch);

  assert.equal(callCount, 2, "should stop after partial page");
  assert.equal(urls.length, 25);
});

test("fetchNautilusUrls: stops pagination on empty array response", async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    if (callCount === 1) return JSON.stringify(makePosts(20));
    return JSON.stringify([]);
  };

  await fetchNautilusUrls(100, mockFetch);

  assert.equal(callCount, 2);
});

test("fetchNautilusUrls: degrades to empty array on fetch error", async () => {
  const mockFetch = async () => {
    throw new Error("API unavailable");
  };

  const urls = await fetchNautilusUrls(10, mockFetch);

  assert.deepEqual(urls, []);
});

test("fetchNautilusUrls: degrades to empty array on invalid JSON", async () => {
  const mockFetch = async () => "this is not json";

  const urls = await fetchNautilusUrls(10, mockFetch);

  assert.deepEqual(urls, []);
});

test("fetchNautilusUrls: degrades to empty array when response is not an array", async () => {
  const mockFetch = async () => JSON.stringify({ error: "not found" });

  const urls = await fetchNautilusUrls(10, mockFetch);

  assert.deepEqual(urls, []);
});

test("fetchNautilusUrls: skips posts with missing or non-string link", async () => {
  const posts = [
    { link: "https://nautil.us/valid-story-123456/" },
    { link: null },
    { title: "no link field" },
    { link: 42 },
  ];
  const mockFetch = async () => JSON.stringify(posts);

  const urls = await fetchNautilusUrls(10, mockFetch);

  assert.deepEqual(urls, ["https://nautil.us/valid-story-123456/"]);
});

// ---------------------------------------------------------------------------
// NAUTILUS_WP_CATEGORY_MAP
// ---------------------------------------------------------------------------

test("NAUTILUS_WP_CATEGORY_MAP: all Nautilus section slugs have entries", () => {
  const expectedSections = [
    "art-science",
    "biology-beyond",
    "cosmos",
    "culture",
    "earth",
    "life",
    "mind",
    "ocean",
  ];
  for (const slug of expectedSections) {
    assert.ok(
      NAUTILUS_WP_CATEGORY_MAP[slug] !== undefined,
      `Section "${slug}" must have a WP category ID`,
    );
    assert.ok(
      typeof NAUTILUS_WP_CATEGORY_MAP[slug] === "number",
      `WP category ID for "${slug}" must be a number`,
    );
  }
});

// ---------------------------------------------------------------------------
// Nautilus provider urlExtractor integration
// ---------------------------------------------------------------------------

test("Nautilus urlExtractor: delegates to WP API via injected fetch", async () => {
  const { getProvider } = await import("@/lib/scraper/providers");
  const nautilus = getProvider("nautilus");
  assert.ok(nautilus?.urlExtractor, "Nautilus provider must have a urlExtractor");

  const posts = makePosts(3);
  const mockFetch = async () => JSON.stringify(posts);

  const urls = await nautilus!.urlExtractor!({ limit: 10, fetch: mockFetch });

  assert.equal(urls.length, 3);
  assert.ok(urls.every((u) => u.startsWith("https://nautil.us/")));
});

test("Nautilus urlExtractor: degrades gracefully on API failure", async () => {
  const { getProvider } = await import("@/lib/scraper/providers");
  const nautilus = getProvider("nautilus");
  assert.ok(nautilus?.urlExtractor);

  const urls = await nautilus!.urlExtractor!({
    limit: 10,
    fetch: async () => {
      throw new Error("network timeout");
    },
  });

  assert.deepEqual(urls, []);
});
