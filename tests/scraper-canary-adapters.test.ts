/**
 * Pure unit tests for the Phase-1.10 discovery CANARY adapters (issue #1090).
 *
 * Each adapter (RSS / sitemap / seed-HTML) implements the `DiscoveryPageFetcher`
 * seam over ONE injected document fetch and must:
 *   - yield the expected sanitized items with the correct dates + provenance;
 *   - reach the observable boundary in a single window (`boundaryReached === true`);
 *   - surface an empty page (nothing changed) on a `304 not-modified`;
 *   - THROW a CanaryFetchError on retryable/error/blocked outcomes so the run
 *     handler isolates the source;
 *   - perform ZERO body fetches — the injected fetch is called EXACTLY once, with
 *     the single channel-document URL, and never a per-article URL (AC4).
 */
process.env.LOG_LEVEL = "error";

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { CandidateDateProvenance, type DiscoverySource } from "@prisma/client";

import type { DiscoveryFetch, DiscoveryFetchResult } from "@/lib/scraper/fetch";
import { makeRssCanaryAdapter } from "@/lib/scraper/incremental/adapters/rss-adapter";
import { makeSitemapCanaryAdapter } from "@/lib/scraper/incremental/adapters/sitemap-adapter";
import { makeSeedHtmlCanaryAdapter } from "@/lib/scraper/incremental/adapters/html-seed-adapter";
import { CanaryFetchError, type CanaryAdapterConfig } from "@/lib/scraper/incremental/adapters/types";

const feedXml = readFileSync("tests/fixtures/canary/theconversation-feed.xml", "utf8");
const sitemapXml = readFileSync("tests/fixtures/canary/worksinprogress-sitemap.xml", "utf8");
const seedHtml = readFileSync("tests/fixtures/canary/undark-index.html", "utf8");

/** A fake source row (adapters ignore mutable source state). */
const SOURCE = { id: "src-1" } as unknown as DiscoverySource;

/** Builds a fetch stub that records every URL it is called with. */
function recordingFetch(result: DiscoveryFetchResult): {
  fetch: DiscoveryFetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetch: DiscoveryFetch = async (url) => {
    calls.push(url);
    return result;
  };
  return { fetch, calls };
}

function okResult(body: string, validators: { etag?: string; lastModified?: string } = {}): DiscoveryFetchResult {
  return {
    outcome: "ok",
    status: 200,
    finalUrl: "https://example.test/doc",
    body,
    notModified: false,
    validators,
    headers: {},
  };
}

// ---------------------------------------------------------------------------
// RSS canary adapter
// ---------------------------------------------------------------------------

test("RSS canary adapter yields feed items with trusted FEED dates and reaches boundary", async () => {
  const config: CanaryAdapterConfig = {
    channel: "rss",
    documentUrl: "https://theconversation.com/articles.atom",
    dateTrust: "trusted",
  };
  const { fetch, calls } = recordingFetch(okResult(feedXml, { etag: "W/\"abc\"" }));
  const adapter = makeRssCanaryAdapter(config, { fetchResponse: fetch });

  const page = await adapter({ source: SOURCE });

  assert.equal(page.boundaryReached, true);
  assert.equal(page.continuation, null);
  // All feed entries are surfaced (admission/pattern filtering happens in classify).
  const urls = page.items.map((i) => i.url);
  assert.ok(urls.includes("https://theconversation.com/how-birds-navigate-using-magnetic-fields-217534"));
  assert.ok(urls.includes("https://theconversation.com/the-chemistry-of-ocean-carbon-capture-218901"));
  // Trusted feed dates carry FEED provenance.
  const first = page.items.find((i) =>
    i.url.endsWith("magnetic-fields-217534"),
  );
  assert.ok(first?.publishedAt instanceof Date);
  assert.equal(first?.dateProvenance, CandidateDateProvenance.FEED);
  assert.equal(first?.positionRank, 0);
  assert.equal(page.validators?.etag, "W/\"abc\"");

  // AC4: exactly ONE fetch, of the feed document — never a per-article body.
  assert.deepEqual(calls, ["https://theconversation.com/articles.atom"]);
});

test("RSS canary adapter drops per-item dates when the channel date-trust is untrusted", async () => {
  const config: CanaryAdapterConfig = {
    channel: "rss",
    documentUrl: "https://theconversation.com/articles.atom",
    dateTrust: "untrusted",
  };
  const { fetch } = recordingFetch(okResult(feedXml));
  const adapter = makeRssCanaryAdapter(config, { fetchResponse: fetch });
  const page = await adapter({ source: SOURCE });
  assert.ok(page.items.length > 0);
  for (const item of page.items) {
    assert.equal(item.publishedAt, undefined);
    assert.equal(item.dateProvenance, undefined);
  }
});

// ---------------------------------------------------------------------------
// Sitemap canary adapter
// ---------------------------------------------------------------------------

test("sitemap canary adapter yields loc entries with trusted PAGE_METADATA dates", async () => {
  const config: CanaryAdapterConfig = {
    channel: "sitemap",
    documentUrl: "https://worksinprogress.co/post-sitemap.xml",
    dateTrust: "trusted",
  };
  const { fetch, calls } = recordingFetch(okResult(sitemapXml, { lastModified: "Wed, 17 Jul 2024 00:00:00 GMT" }));
  const adapter = makeSitemapCanaryAdapter(config, { fetchResponse: fetch });

  const page = await adapter({ source: SOURCE });

  assert.equal(page.boundaryReached, true);
  const urls = page.items.map((i) => i.url);
  assert.ok(urls.includes("https://worksinprogress.co/issue/the-story-of-state-capacity/"));
  const dated = page.items.find((i) => i.url.endsWith("the-story-of-state-capacity/"));
  assert.ok(dated?.publishedAt instanceof Date);
  assert.equal(dated?.dateProvenance, CandidateDateProvenance.PAGE_METADATA);
  assert.equal(page.validators?.lastModified, "Wed, 17 Jul 2024 00:00:00 GMT");
  assert.deepEqual(calls, ["https://worksinprogress.co/post-sitemap.xml"]);
});

// ---------------------------------------------------------------------------
// Seed-HTML canary adapter
// ---------------------------------------------------------------------------

test("seed-HTML canary adapter yields undated anchor links (resolving relative hrefs)", async () => {
  const config: CanaryAdapterConfig = {
    channel: "seed-html",
    documentUrl: "https://undark.org/",
    dateTrust: "untrusted",
  };
  const { fetch, calls } = recordingFetch(okResult(seedHtml));
  const adapter = makeSeedHtmlCanaryAdapter(config, { fetchResponse: fetch });

  const page = await adapter({ source: SOURCE });

  assert.equal(page.boundaryReached, true);
  const urls = page.items.map((i) => i.url);
  assert.ok(urls.includes("https://undark.org/2024/06/15/the-ocean-mystery-of-carbon/"));
  // Relative href resolved against the seed document URL.
  assert.ok(urls.includes("https://undark.org/2024/06/20/mapping-the-deep-sea/"));
  // Seed HTML carries no trusted per-item date → all items undated.
  for (const item of page.items) {
    assert.equal(item.publishedAt, undefined);
    assert.equal(item.dateProvenance, undefined);
  }
  assert.deepEqual(calls, ["https://undark.org/"]);
});

// ---------------------------------------------------------------------------
// Typed-outcome handling (shared)
// ---------------------------------------------------------------------------

test("canary adapter returns an empty boundary page on 304 not-modified", async () => {
  const config: CanaryAdapterConfig = {
    channel: "rss",
    documentUrl: "https://theconversation.com/articles.atom",
    dateTrust: "trusted",
  };
  const notModified: DiscoveryFetchResult = {
    outcome: "not-modified",
    status: 304,
    finalUrl: "https://theconversation.com/articles.atom",
    notModified: true,
    validators: { etag: "W/\"abc\"" },
  };
  const { fetch, calls } = recordingFetch(notModified);
  const adapter = makeRssCanaryAdapter(config, { fetchResponse: fetch });

  const page = await adapter({ source: SOURCE });
  assert.deepEqual(page.items, []);
  assert.equal(page.boundaryReached, true);
  assert.equal(page.validators?.etag, "W/\"abc\"");
  assert.equal(calls.length, 1);
});

test("canary adapter throws CanaryFetchError on retryable/error/blocked outcomes", async () => {
  const config: CanaryAdapterConfig = {
    channel: "sitemap",
    documentUrl: "https://worksinprogress.co/post-sitemap.xml",
    dateTrust: "trusted",
  };
  const cases: DiscoveryFetchResult[] = [
    { outcome: "retryable", status: 503, finalUrl: "https://x.test" },
    { outcome: "error", status: 404, finalUrl: "https://x.test" },
    { outcome: "blocked", reason: "unsafe-address" },
  ];
  for (const result of cases) {
    const { fetch } = recordingFetch(result);
    const adapter = makeSitemapCanaryAdapter(config, { fetchResponse: fetch });
    await assert.rejects(() => adapter({ source: SOURCE }), CanaryFetchError);
  }
});

test("canary adapter honours the per-document item cap (single bounded window)", async () => {
  const config: CanaryAdapterConfig = {
    channel: "rss",
    documentUrl: "https://theconversation.com/articles.atom",
    dateTrust: "trusted",
    maxItems: 2,
  };
  const { fetch } = recordingFetch(okResult(feedXml));
  const adapter = makeRssCanaryAdapter(config, { fetchResponse: fetch });
  const page = await adapter({ source: SOURCE });
  assert.equal(page.items.length, 2);
  assert.equal(page.boundaryReached, true);
});
