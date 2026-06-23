/**
 * Tests for the Aeon GraphQL URL extractor (#363).
 * No real network — injectable fetch with fixture responses.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAeonUrls, AEON_GRAPHQL_ENDPOINT } from "@/lib/scraper/aeon-graphql";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGraphQlResponse(
  articles: Array<{ url: string; type?: string; slug?: string }>,
  hasNextPage = false,
  endCursor: string | null = null,
) {
  return JSON.stringify({
    data: {
      articles: {
        edges: articles.map((a, i) => ({
          node: { url: a.url, type: a.type ?? "essay", slug: a.slug ?? `slug-${i}` },
          cursor: `cursor-${i}`,
        })),
        pageInfo: { hasNextPage, endCursor },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// fetchAeonUrls unit tests
// ---------------------------------------------------------------------------

test("fetchAeonUrls: returns essay URLs from a single page", async () => {
  const essays = [
    { url: "https://aeon.co/essays/why-the-sky-is-blue" },
    { url: "https://aeon.co/essays/consciousness-and-machines" },
  ];
  const mockFetch = async (_url: string, _init?: unknown) =>
    makeGraphQlResponse(essays, false, null);

  const urls = await fetchAeonUrls(10, mockFetch);

  assert.deepEqual(urls, [
    "https://aeon.co/essays/why-the-sky-is-blue",
    "https://aeon.co/essays/consciousness-and-machines",
  ]);
});

test("fetchAeonUrls: follows cursor pagination across pages", async () => {
  let callCount = 0;
  const mockFetch = async (_url: string, _init?: unknown) => {
    callCount++;
    if (callCount === 1) {
      return makeGraphQlResponse(
        [{ url: "https://aeon.co/essays/page-one-story" }],
        true,
        "cursor-page-1",
      );
    }
    // Page 2
    return makeGraphQlResponse(
      [{ url: "https://aeon.co/essays/page-two-story" }],
      false,
      null,
    );
  };

  const urls = await fetchAeonUrls(10, mockFetch);

  assert.equal(callCount, 2, "should fetch both pages");
  assert.ok(urls.includes("https://aeon.co/essays/page-one-story"), "page 1 story present");
  assert.ok(urls.includes("https://aeon.co/essays/page-two-story"), "page 2 story present");
});

test("fetchAeonUrls: cursor is passed in subsequent requests", async () => {
  const receivedCursors: Array<string | undefined> = [];

  const mockFetch = async (_url: string, init?: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as { variables?: { after?: string } }) : {};
    receivedCursors.push(body.variables?.after);

    if (receivedCursors.length === 1) {
      return makeGraphQlResponse(
        [{ url: "https://aeon.co/essays/first" }],
        true,
        "cursor-abc",
      );
    }
    return makeGraphQlResponse([{ url: "https://aeon.co/essays/second" }], false, null);
  };

  await fetchAeonUrls(10, mockFetch);

  assert.equal(receivedCursors[0], undefined, "first request has no cursor");
  assert.equal(receivedCursors[1], "cursor-abc", "second request passes cursor");
});

test("fetchAeonUrls: filters out non-essay nodes (e.g. video type)", async () => {
  const items = [
    { url: "https://aeon.co/essays/valid-essay", type: "essay" },
    { url: "https://aeon.co/videos/a-video", type: "video" },
    { url: "https://aeon.co/essays/another-essay", type: "Essay" },
  ];
  const mockFetch = async (_url: string, _init?: unknown) =>
    makeGraphQlResponse(items, false, null);

  const urls = await fetchAeonUrls(10, mockFetch);

  assert.ok(urls.includes("https://aeon.co/essays/valid-essay"), "essay included");
  assert.ok(urls.includes("https://aeon.co/essays/another-essay"), "Essay (cap) included");
  assert.ok(!urls.some((u) => u.includes("video")), "video excluded");
});

test("fetchAeonUrls: deduplicates URLs returned across pages", async () => {
  let callCount = 0;
  const mockFetch = async (_url: string, _init?: unknown) => {
    callCount++;
    if (callCount === 1) {
      return makeGraphQlResponse(
        [{ url: "https://aeon.co/essays/duplicate-story" }],
        true,
        "cursor-1",
      );
    }
    return makeGraphQlResponse(
      [{ url: "https://aeon.co/essays/duplicate-story" }],
      false,
      null,
    );
  };

  const urls = await fetchAeonUrls(10, mockFetch);

  const dupCount = urls.filter((u) => u === "https://aeon.co/essays/duplicate-story").length;
  assert.equal(dupCount, 1, "duplicate URL should appear only once");
});

test("fetchAeonUrls: degrades gracefully on fetch error", async () => {
  const mockFetch = async () => {
    throw new Error("GraphQL endpoint unreachable");
  };

  const urls = await fetchAeonUrls(10, mockFetch);

  assert.deepEqual(urls, []);
});

test("fetchAeonUrls: degrades gracefully on GraphQL errors in response", async () => {
  const errorResponse = JSON.stringify({
    errors: [{ message: "Internal server error" }, { message: "Schema mismatch" }],
  });
  const mockFetch = async () => errorResponse;

  const urls = await fetchAeonUrls(10, mockFetch);

  assert.deepEqual(urls, []);
});

test("fetchAeonUrls: degrades gracefully when data.articles is missing (schema drift)", async () => {
  const mockFetch = async () =>
    JSON.stringify({ data: { something_else: {} } });

  const urls = await fetchAeonUrls(10, mockFetch);

  assert.deepEqual(urls, []);
});

test("fetchAeonUrls: uses POST to the correct endpoint", async () => {
  let capturedUrl: string | undefined;
  let capturedMethod: string | undefined;

  const mockFetch = async (url: string, init?: { method?: string }) => {
    capturedUrl = url;
    capturedMethod = init?.method;
    return makeGraphQlResponse([], false, null);
  };

  await fetchAeonUrls(5, mockFetch);

  assert.equal(capturedUrl, AEON_GRAPHQL_ENDPOINT, "must POST to the Aeon endpoint");
  assert.equal(capturedMethod, "POST", "must use POST method");
});

test("fetchAeonUrls: strips #fragments from returned URLs", async () => {
  const items = [{ url: "https://aeon.co/essays/a-story#section-2", type: "essay" }];
  const mockFetch = async () => makeGraphQlResponse(items, false, null);

  const urls = await fetchAeonUrls(10, mockFetch);

  assert.deepEqual(urls, ["https://aeon.co/essays/a-story"]);
});

// ---------------------------------------------------------------------------
// Aeon provider urlExtractor integration
// ---------------------------------------------------------------------------

test("Aeon urlExtractor: delegates to GraphQL API via injected fetch", async () => {
  const { getProvider } = await import("@/lib/scraper/providers");
  const aeon = getProvider("aeon");
  assert.ok(aeon?.urlExtractor, "Aeon provider must have a urlExtractor");

  const essays = [{ url: "https://aeon.co/essays/test-essay" }];
  const mockFetch = async () => makeGraphQlResponse(essays, false, null);

  const urls = await aeon!.urlExtractor!({ limit: 10, fetch: mockFetch });

  assert.deepEqual(urls, ["https://aeon.co/essays/test-essay"]);
});

test("Aeon urlExtractor: degrades gracefully on API failure", async () => {
  const { getProvider } = await import("@/lib/scraper/providers");
  const aeon = getProvider("aeon");
  assert.ok(aeon?.urlExtractor);

  const urls = await aeon!.urlExtractor!({
    limit: 10,
    fetch: async () => {
      throw new Error("connection refused");
    },
  });

  assert.deepEqual(urls, []);
});
