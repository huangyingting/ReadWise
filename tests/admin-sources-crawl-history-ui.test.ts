/**
 * Unit tests for the admin crawl-run history UI wiring (#1153).
 *
 * The backend `GET /api/admin/sources/[key]/crawl-runs` (gated sources.manage)
 * existed for privacy-safe provider drift triage but had NO UI consumer — the
 * Sources page only showed the 3 most-recent runs inline per provider. This adds
 * an `AdminSourceCrawlHistory` client island (a "View history" trigger + Sheet)
 * wired into the Sources page, backed by pure helpers in
 * `src/lib/admin/sources/crawl-history-ui.ts`.
 *
 * Mirrors the source-string + mocked-`client-fetch` conventions of
 * tests/admin-series-reorder-ui.test.ts (no jsdom / real DOM). The pure helpers
 * + endpoint builder that feed getJson are asserted directly (and via a mock);
 * the island is verified by source-string. Backend behaviour stays covered by
 * the route tests.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  CRAWL_HISTORY_UI_LIMIT,
  crawlRunsEndpoint,
  distinctOutcomes,
  filterByOutcome,
  formatCrawlDuration,
  type CrawlRunHistoryRowView,
} from "@/lib/admin/sources/crawl-history-ui";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

function makeRun(overrides: Partial<CrawlRunHistoryRowView> = {}): CrawlRunHistoryRowView {
  return {
    id: "run-1",
    providerKey: "reuters",
    source: "rss",
    mode: "incremental",
    outcome: "success",
    durationMs: 1234,
    discovered: 5,
    scraped: 4,
    failed: 1,
    duplicates: 0,
    rejected: 0,
    error: null,
    createdAt: "2026-07-20T20:00:00.000Z",
    ...overrides,
  };
}

type GetCall = { url: string };
let getCalls: GetCall[] = [];
let getResponse: unknown;
let clientFetch: typeof import("@/lib/client-fetch");

before(async () => {
  mock.module("@/lib/client-fetch", {
    namedExports: {
      getJson: async (url: string) => {
        getCalls.push({ url });
        return getResponse;
      },
    },
  });
  clientFetch = await import("@/lib/client-fetch");
});

beforeEach(() => {
  getCalls = [];
  getResponse = null;
});

// ---------------------------------------------------------------------------
// crawlRunsEndpoint — exact strings + encoding
// ---------------------------------------------------------------------------

test("crawlRunsEndpoint builds the exact route with the default UI limit", () => {
  assert.equal(CRAWL_HISTORY_UI_LIMIT, 50);
  assert.equal(crawlRunsEndpoint("reuters"), "/api/admin/sources/reuters/crawl-runs?limit=50");
});

test("crawlRunsEndpoint honours an explicit limit", () => {
  assert.equal(crawlRunsEndpoint("reuters", 10), "/api/admin/sources/reuters/crawl-runs?limit=10");
});

test("crawlRunsEndpoint URL-encodes a provider key that needs it", () => {
  assert.equal(
    crawlRunsEndpoint("acme news/eu"),
    "/api/admin/sources/acme%20news%2Feu/crawl-runs?limit=50",
  );
});

// ---------------------------------------------------------------------------
// distinctOutcomes — de-dupe preserving first-seen order
// ---------------------------------------------------------------------------

test("distinctOutcomes de-dupes preserving first-seen order", () => {
  const runs = [
    makeRun({ id: "1", outcome: "success" }),
    makeRun({ id: "2", outcome: "failed" }),
    makeRun({ id: "3", outcome: "success" }),
    makeRun({ id: "4", outcome: "partial" }),
  ];
  assert.deepEqual(distinctOutcomes(runs), ["success", "failed", "partial"]);
  assert.deepEqual(distinctOutcomes([]), []);
});

// ---------------------------------------------------------------------------
// filterByOutcome — "" returns all, a value filters, input not mutated
// ---------------------------------------------------------------------------

test("filterByOutcome returns all for the empty sentinel and filters otherwise", () => {
  const runs = [
    makeRun({ id: "1", outcome: "success" }),
    makeRun({ id: "2", outcome: "failed" }),
    makeRun({ id: "3", outcome: "success" }),
  ];
  assert.equal(filterByOutcome(runs, "").length, 3, "empty sentinel returns all");
  const failed = filterByOutcome(runs, "failed");
  assert.deepEqual(failed.map((r) => r.id), ["2"]);
  // Input is not mutated.
  assert.deepEqual(runs.map((r) => r.id), ["1", "2", "3"]);
  assert.notEqual(filterByOutcome(runs, ""), runs, "returns a new array, not the input");
});

// ---------------------------------------------------------------------------
// formatCrawlDuration — null / <1s / >=1s
// ---------------------------------------------------------------------------

test("formatCrawlDuration formats null, sub-second, and second durations", () => {
  assert.equal(formatCrawlDuration(null), "duration unknown");
  assert.equal(formatCrawlDuration(0), "0ms");
  assert.equal(formatCrawlDuration(999), "999ms");
  assert.equal(formatCrawlDuration(1000), "1.0s");
  assert.equal(formatCrawlDuration(1234), "1.2s");
});

// ---------------------------------------------------------------------------
// Mocked getJson — the island's fetch lands on crawlRunsEndpoint(providerKey)
// ---------------------------------------------------------------------------

test("getJson loads crawl runs from crawlRunsEndpoint(providerKey) with limit=50", async () => {
  getResponse = { ok: true, providerKey: "reuters", runs: [makeRun()] };
  const res = await clientFetch.getJson<{ runs: CrawlRunHistoryRowView[] }>(
    crawlRunsEndpoint("reuters"),
  );
  assert.equal(getCalls[0]?.url, "/api/admin/sources/reuters/crawl-runs?limit=50");
  assert.equal(res.runs.length, 1);
});

// ---------------------------------------------------------------------------
// AdminSourceCrawlHistory island — primitives, states, wiring, token-driven
// ---------------------------------------------------------------------------

test("AdminSourceCrawlHistory is a read-only client island wired to the helpers", () => {
  const src = readSrc("src/components/admin/sources/AdminSourceCrawlHistory.tsx");
  assert.ok(src.includes('"use client"'), "must be a client component");
  assert.ok(src.includes("getJson"), "loads via getJson");
  assert.ok(!src.includes("useMutation"), "read-only — no mutation hook");
  assert.ok(src.includes("crawlRunsEndpoint"), "builds the URL from the pure helper");
  assert.ok(src.includes("distinctOutcomes"), "derives filter options from the pure helper");
  assert.ok(src.includes("filterByOutcome"), "filters via the pure helper");
  assert.ok(src.includes("classifyAdminFetchError"), "classifies fetch errors");
  assert.ok(src.includes("<Sheet"), "opens a Sheet");
  assert.ok(src.includes("Skeleton"), "renders a loading skeleton");
  assert.ok(src.includes("EmptyState"), "renders an empty state");
  assert.ok(src.includes("View history"), "has a 'View history' trigger");
  assert.ok(src.includes("<Select"), "has an outcome filter Select");
  assert.ok(src.includes("aria-live"), "announces filtered count via aria-live");
  assert.ok(src.includes("Retry"), "offers a Retry on fetch error");
  // Columns.
  for (const header of ["Outcome", "When", "Source / Mode", "Duration", "Error"]) {
    assert.ok(src.includes(`>${header}<`), `keeps the ${header} column`);
  }
});

test("AdminSourceCrawlHistory is token-driven (no raw hex, no inline font-size/style)", () => {
  const src = readSrc("src/components/admin/sources/AdminSourceCrawlHistory.tsx").replace(/#\d+/g, "");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
  assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
  assert.ok(!src.includes("style={{"), "must not use inline styles");
});

test("crawl-history DTO imports the backend row type as a type-only import (erased)", () => {
  const src = readSrc("src/lib/admin/sources/crawl-history-ui.ts");
  assert.ok(
    src.includes('import type { CrawlRunHistoryRow } from "@/lib/scraper/sources"'),
    "type-only import — never pulls the Prisma runtime into the bundle",
  );
  assert.ok(src.includes("CRAWL_HISTORY_UI_LIMIT = 50"), "defines a local limit literal");
});

// ---------------------------------------------------------------------------
// Sources page — renders the island
// ---------------------------------------------------------------------------

test("the Sources page renders AdminSourceCrawlHistory per row", () => {
  const src = readSrc("src/app/admin/sources/page.tsx");
  assert.ok(src.includes("AdminSourceCrawlHistory"), "imports + renders the history island");
  assert.ok(src.includes("<RecentRuns"), "keeps the inline 3-run summary");
});
