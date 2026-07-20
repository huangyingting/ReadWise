/**
 * Unit tests for the admin series article-MANAGER UI wiring (#1157).
 *
 * The admin Series table could create a series, edit metadata, and reorder its
 * members — but had NO way to ADD or REMOVE articles, so an operator could
 * create a series that could never be populated (and the old reorder UI showed
 * opaque article IDs, not titles). This adds an `AdminSeriesArticleManager`
 * client island (a "Manage articles" trigger + Sheet) wired into
 * `AdminSeriesRowActions`, backed by pure helpers in
 * `src/lib/admin/series/manage-ui.ts`.
 *
 * Mirrors the source-string + mocked-`client-fetch` conventions of
 * tests/admin-series-reorder-ui.test.ts (no jsdom / real DOM). The pure helpers
 * + endpoint builders that feed getJson/patchJson are asserted directly (and via
 * mocks); the island is verified by source-string. Backend behaviour (title
 * resolution + PATCH persistence) stays covered by tests/series-curation-service
 * and tests/admin-series-routes.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  addArticleId,
  adminArticlesSearchEndpoint,
  removeArticleId,
  seriesManageEndpoint,
} from "@/lib/admin/series/manage-ui";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

type GetCall = { url: string };
type PatchCall = { url: string; body: unknown };
let getCalls: GetCall[] = [];
let patchCalls: PatchCall[] = [];
let getResponse: unknown;
let patchResponse: unknown;
let clientFetch: typeof import("@/lib/client-fetch");

before(async () => {
  mock.module("@/lib/client-fetch", {
    namedExports: {
      getJson: async (url: string) => {
        getCalls.push({ url });
        return getResponse;
      },
      patchJson: async (url: string, body: unknown) => {
        patchCalls.push({ url, body });
        return patchResponse;
      },
    },
  });
  clientFetch = await import("@/lib/client-fetch");
});

beforeEach(() => {
  getCalls = [];
  patchCalls = [];
  getResponse = null;
  patchResponse = null;
});

// ---------------------------------------------------------------------------
// Endpoint builders — exact strings
// ---------------------------------------------------------------------------

test("seriesManageEndpoint builds the exact detail route", () => {
  assert.equal(seriesManageEndpoint("s-1"), "/api/admin/series/s-1");
});

test("adminArticlesSearchEndpoint encodes + trims the query (and omits it when empty)", () => {
  assert.equal(adminArticlesSearchEndpoint("space"), "/api/admin/articles?q=space");
  assert.equal(adminArticlesSearchEndpoint("  hello world  "), "/api/admin/articles?q=hello+world");
  assert.equal(adminArticlesSearchEndpoint("a&b=c"), "/api/admin/articles?q=a%26b%3Dc");
  assert.equal(adminArticlesSearchEndpoint(""), "/api/admin/articles");
  assert.equal(adminArticlesSearchEndpoint("   "), "/api/admin/articles");
});

// ---------------------------------------------------------------------------
// addArticleId / removeArticleId — pure, immutable, de-duplicating
// ---------------------------------------------------------------------------

test("addArticleId appends only when absent and never mutates its input", () => {
  const ids = ["a", "b"];
  assert.deepEqual(addArticleId(ids, "c"), ["a", "b", "c"]);
  assert.deepEqual(addArticleId(ids, "a"), ["a", "b"], "no duplicate is added");
  assert.notEqual(addArticleId(ids, "a"), ids, "returns a new array even on a no-op");
  assert.deepEqual(ids, ["a", "b"], "input is unchanged");
});

test("removeArticleId removes every occurrence and never mutates its input", () => {
  const ids = ["a", "b", "a", "c"];
  assert.deepEqual(removeArticleId(ids, "a"), ["b", "c"]);
  assert.deepEqual(removeArticleId(ids, "z"), ["a", "b", "a", "c"], "missing id is a no-op");
  assert.deepEqual(ids, ["a", "b", "a", "c"], "input is unchanged");
});

// ---------------------------------------------------------------------------
// Mocked getJson/patchJson — the exact calls the island makes
// ---------------------------------------------------------------------------

test("getJson loads the detail (id + articleIds + resolved articles) from the manage endpoint", async () => {
  getResponse = {
    series: {
      id: "s-9",
      articleIds: ["a", "b"],
      articles: [
        { id: "a", title: "Alpha", slug: "alpha" },
        { id: "b", title: "Beta", slug: null },
      ],
    },
  };
  const res = await clientFetch.getJson<{
    series: { id: string; articleIds: string[]; articles: Array<{ id: string; title: string }> };
  }>(seriesManageEndpoint("s-9"));
  assert.equal(getCalls[0]?.url, "/api/admin/series/s-9");
  assert.deepEqual(res.series.articleIds, ["a", "b"]);
  assert.equal(res.series.articles[1]?.title, "Beta");
});

test("patchJson persists exactly { articleIds } (add + remove + reorder folded into one PATCH)", async () => {
  const next = addArticleId(removeArticleId(["a", "b", "c"], "b"), "d"); // ["a","c","d"]
  patchResponse = { ok: true, series: { id: "s-9", articleIds: next, articles: [] } };
  await clientFetch.patchJson(seriesManageEndpoint("s-9"), { articleIds: next });
  assert.equal(patchCalls.length, 1);
  assert.equal(patchCalls[0]?.url, "/api/admin/series/s-9");
  assert.deepEqual(
    patchCalls[0]?.body,
    { articleIds: ["a", "c", "d"] },
    "body is exactly { articleIds: [...] } — no extra fields",
  );
  assert.deepEqual(Object.keys(patchCalls[0]?.body as object), ["articleIds"]);
});

// ---------------------------------------------------------------------------
// AdminSeriesArticleManager island — primitives, states, wiring
// ---------------------------------------------------------------------------

test("AdminSeriesArticleManager is a client island wired to the manage + search helpers", () => {
  const src = readSrc("src/components/admin/series/AdminSeriesArticleManager.tsx");
  assert.ok(src.includes('"use client"'), "must be a client component");
  assert.ok(src.includes("getJson"), "loads detail + searches via getJson");
  assert.ok(src.includes("patchJson"), "persists via patchJson");
  assert.ok(src.includes("seriesManageEndpoint"), "builds the detail/PATCH URL from the pure helper");
  assert.ok(src.includes("adminArticlesSearchEndpoint"), "builds the search URL from the pure helper");
  assert.ok(src.includes("addArticleId"), "adds via the pure helper");
  assert.ok(src.includes("removeArticleId"), "removes via the pure helper");
  assert.ok(src.includes("moveArticleId"), "reorders via the shared pure helper");
  assert.ok(src.includes("sameOrder"), "gates Save/Reset on sameOrder");
  assert.ok(src.includes("classifyAdminFetchError"), "classifies fetch errors");
  assert.ok(src.includes("useMutation"), "uses the shared mutation hook for busy/error");
  assert.ok(src.includes("useFilteredFetch"), "debounces + aborts search via the shared hook");
  assert.ok(src.includes("router.refresh"), "refreshes on a successful save");
  assert.ok(src.includes("<Sheet"), "opens a Sheet");
  assert.ok(src.includes("Skeleton"), "renders a loading skeleton");
  assert.ok(src.includes("EmptyState"), "renders empty states (no members / no matches)");
  assert.ok(src.includes("Retry"), "offers a Retry on detail fetch error");
});

test("AdminSeriesArticleManager exposes add / remove / move controls with accessible labels", () => {
  const src = readSrc("src/components/admin/series/AdminSeriesArticleManager.tsx");
  assert.ok(src.includes("Manage articles"), "has a Manage articles trigger");
  assert.ok(src.includes("to series"), "per-row add/remove buttons name the article + series");
  assert.ok(src.includes('"up"'), 'has an "up" move direction');
  assert.ok(src.includes('"down"'), 'has a "down" move direction');
  assert.ok(src.includes("Save changes"), "has a Save action");
  assert.ok(src.includes("Reset"), "has a Reset action");
  assert.ok(src.includes("aria-live"), "announces membership status via aria-live");
});

test("AdminSeriesRowActions renders the manager (no articleCount guard)", () => {
  const src = readSrc("src/components/AdminSeriesRowActions.tsx");
  assert.ok(src.includes("AdminSeriesArticleManager"), "imports + renders the manager island");
  assert.ok(
    !src.includes("AdminSeriesReorder"),
    "no longer renders the retired ID-only reorder island",
  );
});

// ---------------------------------------------------------------------------
// Token-driven (no raw hex / inline font-size / inline style)
// ---------------------------------------------------------------------------

test("AdminSeriesArticleManager is token-driven (no raw hex, no inline font-size/style)", () => {
  const src = readSrc("src/components/admin/series/AdminSeriesArticleManager.tsx").replace(/#\d+/g, "");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
  assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
  assert.ok(!src.includes("style={{"), "must not use inline styles");
});

// ---------------------------------------------------------------------------
// Privacy — the DTOs are PUBLIC metadata only (id/title/slug), type-only import
// ---------------------------------------------------------------------------

test("manage-ui DTOs read only public metadata (privacy by construction)", () => {
  const src = readSrc("src/lib/admin/series/manage-ui.ts");
  const normalized = src.replace(/\s+/g, " ");
  assert.ok(
    normalized.includes(
      'Pick< AdminSeriesDetailWithArticles, "id" | "articleIds" | "articles" >',
    ),
    "detail DTO is a narrow Pick of id/articleIds/articles",
  );
  assert.ok(src.includes("import type"), "imports the backend type as a type-only import (erased)");
  assert.ok(src.includes("id: string"), "search hit exposes id");
  assert.ok(src.includes("title: string"), "search hit exposes title");
});
