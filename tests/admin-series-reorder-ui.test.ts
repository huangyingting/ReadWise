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
// Reorder island retired (#1157)
// ---------------------------------------------------------------------------
//
// The ID-only `AdminSeriesReorder` island (#1144) was superseded by the
// `AdminSeriesArticleManager` sheet, which shows titles and folds add/remove
// AND up/down reorder into one surface (see tests/admin-series-article-manager-ui.test.ts).
// The `POST /api/admin/series/[id]/reorder` endpoint + these pure reorder-ui
// helpers (moveArticleId/sameOrder/endpoint builders) remain intact and are
// still exercised above; the manager reuses moveArticleId/sameOrder.

test("AdminSeriesRowActions renders the article manager (superset of reorder)", () => {
  const src = readSrc("src/components/AdminSeriesRowActions.tsx");
  assert.ok(
    src.includes("AdminSeriesArticleManager"),
    "imports + renders the article-manager island",
  );
  assert.ok(
    !src.includes("AdminSeriesReorder"),
    "no longer renders the retired ID-only reorder island",
  );
});

// ---------------------------------------------------------------------------
// Privacy — the DTO is id + articleIds only (no title/content resolution)
// ---------------------------------------------------------------------------

test("reorder DTO reads only id + articleIds (ID-based, privacy by construction)", () => {
  const src = readSrc("src/lib/admin/series/reorder-ui.ts");
  assert.ok(src.includes('Pick<AdminSeriesDetail, "id" | "articleIds">'), "DTO is a narrow Pick");
  assert.ok(src.includes("import type"), "imports the backend type as a type-only import (erased)");
});
