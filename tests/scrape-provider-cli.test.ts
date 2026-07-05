process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyDiscoveryFilters,
  countFinalizedOutcomes,
  parseArgs,
  selectPendingEntries,
  selectPendingUrls,
} from "../scripts/scrape-provider";
import { parseSitemapEntries } from "../src/lib/scraper/providers/shared";
import { parseRssEntries } from "../src/lib/scraper/rss";
import {
  fetchPlanSummary,
  providerWorkflowConfig,
} from "../src/lib/scraper/workflow";
import type { DiscoveredUrl } from "../src/lib/scraper/types";

test("provider workflow CLI parses discover defaults", () => {
  const args = parseArgs(["discover", "--provider", "atlasobscura"]);

  assert.equal(args.command, "discover");
  assert.deepEqual(args.providers, ["atlasobscura"]);
  assert.equal(args.limit, 100);
  assert.equal(args.all, false);
  assert.equal(args.outDir, ".scraper-state/providers");
  assert.equal(args.retryFailed, false);
});

test("provider workflow CLI parses filtered list command", () => {
  const args = parseArgs(["list", "--provider", "atlasobscura"]);

  assert.equal(args.command, "list");
  assert.deepEqual(args.providers, ["atlasobscura"]);
});

test("provider workflow CLI parses all-provider resume overrides", () => {
  const args = parseArgs([
    "resume",
    "--provider",
    "all",
    "--concurrency",
    "5",
    "--delay-ms",
    "500",
    "--include-existing",
  ]);

  assert.equal(args.command, "resume");
  assert.deepEqual(args.providers, ["all"]);
  assert.equal(args.concurrency, 5);
  assert.equal(args.delayMs, 500);
  assert.equal(args.includeExisting, true);
  assert.equal(args.retryFailed, true);
});

test("provider workflow CLI parses time-aware discovery controls", () => {
  const args = parseArgs([
    "discover",
    "--provider",
    "technologyreview",
    "--since",
    "2026-06-28",
    "--order",
    "newest",
    "--stop-after-existing",
    "200",
  ]);

  assert.equal(args.since?.toISOString(), "2026-06-28T00:00:00.000Z");
  assert.equal(args.order, "newest");
  assert.equal(args.stopAfterExisting, 200);
});

test("provider workflow pending URL selection skips existing and finalized URLs", () => {
  const urls = [
    "https://example.test/a",
    "https://example.test/b",
    "https://example.test/c",
    "https://example.test/d",
  ];
  const existing = new Set(["https://example.test/a"]);
  const finalized = new Map([
    ["https://example.test/b", "saved" as const],
    ["https://example.test/c", "failed" as const],
  ]);

  assert.deepEqual(
    selectPendingUrls(urls, existing, finalized, {
      includeExisting: false,
      all: true,
      limit: 10,
      retryFailed: false,
    }),
    ["https://example.test/d"],
  );

  assert.deepEqual(
    selectPendingUrls(urls, existing, finalized, {
      includeExisting: false,
      all: true,
      limit: 10,
      retryFailed: true,
    }),
    ["https://example.test/c", "https://example.test/d"],
  );
});

test("provider workflow orders discovery metadata and filters known old URLs", () => {
  const entries = [
    discoveryEntry("https://example.test/old", { publishedAt: "2026-07-01" }),
    discoveryEntry("https://example.test/mid", { lastModified: "2026-07-03" }),
    discoveryEntry("https://example.test/undated"),
    discoveryEntry("https://example.test/new", { publishedAt: "2026-07-05" }),
  ];

  assert.deepEqual(
    applyDiscoveryFilters(entries, {
      since: new Date("2026-07-02T00:00:00.000Z"),
      order: "newest",
    }).map((entry) => entry.url),
    ["https://example.test/new", "https://example.test/mid", "https://example.test/undated"],
  );
});

test("provider workflow can stop pending selection after consecutive known URLs", () => {
  const entries = [
    discoveryEntry("https://example.test/new"),
    discoveryEntry("https://example.test/existing-one"),
    discoveryEntry("https://example.test/existing-two"),
    discoveryEntry("https://example.test/not-reached"),
  ];

  assert.deepEqual(
    selectPendingEntries(
      entries,
      new Set(["https://example.test/existing-one", "https://example.test/existing-two"]),
      new Map(),
      {
        includeExisting: false,
        all: true,
        limit: 10,
        retryFailed: false,
        stopAfterExisting: 2,
      },
    ).map((entry) => entry.url),
    ["https://example.test/new"],
  );
});

test("provider workflow parses sitemap and RSS dates", () => {
  assert.deepEqual(
    parseSitemapEntries(`
      <urlset>
        <url><loc>https://example.test/a</loc><lastmod>2026-07-05</lastmod></url>
      </urlset>
    `),
    [{ url: "https://example.test/a", lastModified: "2026-07-05T00:00:00.000Z" }],
  );

  assert.deepEqual(
    parseRssEntries(`
      <rss><channel>
        <item><link>https://example.test/b?x=1#frag</link><pubDate>Sun, 05 Jul 2026 02:00:00 GMT</pubDate></item>
      </channel></rss>
    `),
    [{ url: "https://example.test/b", publishedAt: "2026-07-05T02:00:00.000Z" }],
  );
});

test("provider workflow config captures Atlas Playwright tuning", () => {
  const config = providerWorkflowConfig({ key: "atlasobscura" });

  assert.equal(config.concurrency, 5);
  assert.equal(config.requestDelayMs, 500);
  assert.match(fetchPlanSummary(config), /playwright:on fallback/);
  assert.match(fetchPlanSummary(config), /profile-http:off fallback/);
});

test("provider workflow counts finalized outcomes", () => {
  const counts = countFinalizedOutcomes(
    new Map([
      ["a", "saved" as const],
      ["b", "saved" as const],
      ["c", "rejected" as const],
      ["d", "failed" as const],
      ["e", "duplicate" as const],
    ]),
  );

  assert.deepEqual(counts, {
    saved: 2,
    skipped: 0,
    duplicate: 1,
    rejected: 1,
    failed: 1,
    retry: 0,
  });
});

function discoveryEntry(
  url: string,
  dates: Pick<Partial<DiscoveredUrl>, "publishedAt" | "lastModified"> = {},
): DiscoveredUrl {
  return {
    url,
    source: "sitemap",
    discoveredAt: "2026-07-05T00:00:00.000Z",
    ...dates,
  };
}
