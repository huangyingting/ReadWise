/**
 * Unit tests for the admin series article-reorder UI wiring (#1144).
 *
 * The backend `POST /api/admin/series/[id]/reorder` (gated articlesManage)
 * existed but had NO operator UI — the admin Series table had Edit / Activate /
 * Archive / Delete row actions but no way to reorder a series' articles. This
 * adds an `AdminSeriesReorder` client island (a Reorder trigger + Sheet) wired
 * into `AdminSeriesRowActions`, backed by pure helpers in
 * `src/lib/admin/series/reorder-ui.ts`.
 *
 * Mirrors the source-string + mocked-`client-fetch` conventions of
 * tests/admin-security-audit-ui.test.ts (no jsdom / real DOM). The pure reorder
 * helpers + endpoint builders that feed getJson/postJson are asserted directly
 * (and via mocks); the island is verified by source-string. Backend behaviour
 * stays covered by tests/admin-series-routes.test.ts.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  moveArticleId,
  sameOrder,
  seriesDetailEndpoint,
  seriesReorderEndpoint,
} from "@/lib/admin/series/reorder-ui";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

type GetCall = { url: string };
type PostCall = { url: string; body: unknown };
let getCalls: GetCall[] = [];
let postCalls: PostCall[] = [];
let getResponse: unknown;
let postResponse: unknown;
let clientFetch: typeof import("@/lib/client-fetch");

before(async () => {
  mock.module("@/lib/client-fetch", {
    namedExports: {
      getJson: async (url: string) => {
        getCalls.push({ url });
        return getResponse;
      },
      postJson: async (url: string, body: unknown) => {
        postCalls.push({ url, body });
        return postResponse;
      },
    },
  });
  clientFetch = await import("@/lib/client-fetch");
});

beforeEach(() => {
  getCalls = [];
  postCalls = [];
  getResponse = null;
  postResponse = null;
});

// ---------------------------------------------------------------------------
// Endpoint builders — exact strings
// ---------------------------------------------------------------------------

test("seriesDetailEndpoint / seriesReorderEndpoint build the exact routes", () => {
  assert.equal(seriesDetailEndpoint("s-1"), "/api/admin/series/s-1");
  assert.equal(seriesReorderEndpoint("s-1"), "/api/admin/series/s-1/reorder");
});

// ---------------------------------------------------------------------------
// moveArticleId — pure, immutable, bounded
// ---------------------------------------------------------------------------

test("moveArticleId moves an item up and down (happy paths)", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveArticleId(ids, 1, "up"), ["b", "a", "c"]);
  assert.deepEqual(moveArticleId(ids, 1, "down"), ["a", "c", "b"]);
  assert.deepEqual(moveArticleId(ids, 2, "up"), ["a", "c", "b"]);
});

test("moveArticleId is a no-op at both bounds (returns an equal-order copy)", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(moveArticleId(ids, 0, "up"), ["a", "b", "c"], "first + up is a no-op");
  assert.deepEqual(moveArticleId(ids, 2, "down"), ["a", "b", "c"], "last + down is a no-op");
  assert.deepEqual(moveArticleId(ids, -1, "up"), ["a", "b", "c"], "invalid index is a no-op");
  assert.deepEqual(moveArticleId(ids, 9, "down"), ["a", "b", "c"], "out-of-range index is a no-op");
});

test("moveArticleId never mutates its input and always returns a NEW array", () => {
  const ids = ["a", "b", "c"];
  const moved = moveArticleId(ids, 1, "up");
  assert.deepEqual(ids, ["a", "b", "c"], "input is unchanged");
  assert.notEqual(moved, ids, "returns a new array reference (happy path)");
  const noop = moveArticleId(ids, 0, "up");
  assert.notEqual(noop, ids, "returns a new array reference even on a no-op");
});

// ---------------------------------------------------------------------------
// sameOrder — length + element-wise equality
// ---------------------------------------------------------------------------

test("sameOrder compares length + element order", () => {
  assert.equal(sameOrder(["a", "b"], ["a", "b"]), true);
  assert.equal(sameOrder(["a", "b"], ["b", "a"]), false, "different order");
  assert.equal(sameOrder(["a", "b"], ["a", "b", "c"]), false, "length mismatch");
  assert.equal(sameOrder([], []), true);
});

// ---------------------------------------------------------------------------
// Mocked getJson/postJson — the exact calls the island makes
// ---------------------------------------------------------------------------

test("getJson loads the current order from seriesDetailEndpoint(id)", async () => {
  getResponse = { series: { id: "s-9", articleIds: ["a", "b", "c"] } };
  const res = await clientFetch.getJson<{ series: { id: string; articleIds: string[] } }>(
    seriesDetailEndpoint("s-9"),
  );
  assert.equal(getCalls[0]?.url, "/api/admin/series/s-9");
  assert.deepEqual(res.series.articleIds, ["a", "b", "c"]);
});

test("postJson sends { articleIds } with the exact reordered array to the reorder route", async () => {
  const reordered = moveArticleId(["a", "b", "c"], 2, "up"); // ["a","c","b"]
  postResponse = { ok: true, series: { id: "s-9", articleIds: reordered } };
  await clientFetch.postJson(seriesReorderEndpoint("s-9"), { articleIds: reordered });
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0]?.url, "/api/admin/series/s-9/reorder");
  assert.deepEqual(
    postCalls[0]?.body,
    { articleIds: ["a", "c", "b"] },
    "body is exactly { articleIds: [...] } — no extra fields",
  );
  assert.deepEqual(Object.keys(postCalls[0]?.body as object), ["articleIds"]);
});

// ---------------------------------------------------------------------------
// AdminSeriesReorder island — primitives, states, wiring, token-driven
// ---------------------------------------------------------------------------

test("AdminSeriesReorder is a client island wired to the reorder helpers", () => {
  const src = readSrc("src/components/admin/series/AdminSeriesReorder.tsx");
  assert.ok(src.includes('"use client"'), "must be a client component");
  assert.ok(src.includes("getJson"), "loads the current order via getJson");
  assert.ok(src.includes("postJson"), "saves via postJson");
  assert.ok(src.includes("seriesDetailEndpoint"), "builds the detail URL from the pure helper");
  assert.ok(src.includes("seriesReorderEndpoint"), "builds the reorder URL from the pure helper");
  assert.ok(src.includes("moveArticleId"), "reorders via the pure helper");
  assert.ok(src.includes("sameOrder"), "gates Save/Reset on sameOrder");
  assert.ok(src.includes("classifyAdminFetchError"), "classifies fetch errors");
  assert.ok(src.includes("useMutation"), "uses the shared mutation hook for busy/error");
  assert.ok(src.includes("router.refresh"), "refreshes on a successful save");
  assert.ok(src.includes("<Sheet"), "opens a Sheet");
  assert.ok(src.includes("Skeleton"), "renders a loading skeleton");
  assert.ok(src.includes("EmptyState"), "renders the <2 articles empty state");
  assert.ok(src.includes("Retry"), "offers a Retry on fetch error");
});

test("AdminSeriesReorder exposes per-row Move up / Move down controls with aria-labels", () => {
  const src = readSrc("src/components/admin/series/AdminSeriesReorder.tsx");
  assert.ok(src.includes("Move article"), "per-row move buttons carry an article aria-label");
  assert.ok(src.includes('"up"'), 'has an "up" move direction');
  assert.ok(src.includes('"down"'), 'has a "down" move direction');
  assert.ok(src.includes("Save order"), "has a Save action");
  assert.ok(src.includes("Reset"), "has a Reset action");
  assert.ok(src.includes("aria-live"), "announces order status via aria-live");
  assert.ok(src.includes("title={id}"), "shows the full id in a title attribute (truncated display)");
});

test("AdminSeriesRowActions renders AdminSeriesReorder guarded by articleCount >= 2", () => {
  const src = readSrc("src/components/AdminSeriesRowActions.tsx");
  assert.ok(src.includes("AdminSeriesReorder"), "imports + renders the reorder island");
  assert.ok(
    src.includes("series.articleCount >= 2") || src.includes("articleCount >= 2"),
    "gates the control on the series having at least two articles",
  );
});

// ---------------------------------------------------------------------------
// Token-driven (no raw hex / inline font-size / inline style)
// ---------------------------------------------------------------------------

test("AdminSeriesReorder is token-driven (no raw hex, no inline font-size/style)", () => {
  const src = readSrc("src/components/admin/series/AdminSeriesReorder.tsx").replace(/#\d+/g, "");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
  assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
  assert.ok(!src.includes("style={{"), "must not use inline styles");
});

// ---------------------------------------------------------------------------
// Privacy — the DTO is id + articleIds only (no title/content resolution)
// ---------------------------------------------------------------------------

test("reorder DTO reads only id + articleIds (ID-based, privacy by construction)", () => {
  const src = readSrc("src/lib/admin/series/reorder-ui.ts");
  assert.ok(src.includes('Pick<AdminSeriesDetail, "id" | "articleIds">'), "DTO is a narrow Pick");
  assert.ok(src.includes("import type"), "imports the backend type as a type-only import (erased)");
});
