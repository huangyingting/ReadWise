/**
 * Unit tests for searchPublishedArticles in src/lib/articles.ts.
 *
 * Covers: FTS5 page-1 annotation merge, page-N duplicate-prevention (regression
 * for #80), hasMore computation, FTS5 error fallback, and empty query.
 *
 * Mocks: @/lib/prisma (highlight, savedWord, article, $queryRaw),
 *        @/lib/cache (createCachedListing passthrough).
 * No real DB or network is touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { Article } from "@prisma/client";
import { buildArticle } from "./helpers";

// ---------------------------------------------------------------------------
// Mutable state shared by mock implementations (reset in beforeEach)
// ---------------------------------------------------------------------------

let ftsRows: { id: string; rank: number }[] = [];
let shouldThrowFts = false;
let articleDbRows: Article[] = [];
let highlightRows: { articleId: string }[] = [];
let savedWordRows: { articleId: string | null }[] = [];

// ---------------------------------------------------------------------------
// Module mocks — registered once before any module-under-test is imported
// ---------------------------------------------------------------------------

before(() => {
  // Passthrough cache so unstable_cache / Next.js runtime is never needed.
  mock.module("@/lib/cache", {
    namedExports: {
      createCachedListing:
        (fn: (...args: unknown[]) => unknown) =>
        (...args: unknown[]) =>
          fn(...args),
      ARTICLES_CACHE_TAG: "articles",
      TAGS_CACHE_TAG: "tags",
      LISTING_REVALIDATE_SECONDS: 300,
      revalidateArticlesCache: () => {},
      revalidateTagsCache: () => {},
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        // Tagged template literal — receives TemplateStringsArray as first arg.
        $queryRaw: async (..._args: unknown[]) => {
          if (shouldThrowFts) throw new Error("FTS5 unavailable");
          return ftsRows;
        },
        highlight: {
          findMany: async () => highlightRows,
        },
        savedWord: {
          findMany: async () => savedWordRows,
        },
        article: {
          findMany: async (args: {
            where?: { id?: { in?: string[] }; status?: string };
          }) => {
            const ids = args.where?.id?.in;
            // FTS path: filter by explicit id list. LIKE path: return all rows.
            if (!ids) return articleDbRows;
            return articleDbRows.filter((a) => ids.includes(a.id));
          },
        },
      },
    },
  });
});

beforeEach(() => {
  ftsRows = [];
  shouldThrowFts = false;
  articleDbRows = [];
  highlightRows = [];
  savedWordRows = [];
});

// ---------------------------------------------------------------------------
// Page 1: annotation IDs merged and deduplicated
// ---------------------------------------------------------------------------

test("searchPublishedArticles page 1 merges annotation IDs and deduplicates", async () => {
  const { searchPublishedArticles } = await import("@/lib/articles");

  const f1 = buildArticle({ id: "f1" });
  const f2 = buildArticle({ id: "f2" });
  const annot = buildArticle({ id: "annot" });

  ftsRows = [
    { id: "f1", rank: -1.5 },
    { id: "f2", rank: -1.0 },
  ];
  articleDbRows = [f1, f2, annot];
  highlightRows = [{ articleId: "annot" }];
  // f1 is already in the FTS results — it should NOT appear twice
  savedWordRows = [{ articleId: "f1" }];

  const result = await searchPublishedArticles("hello", { offset: 0, limit: 3 }, "user-1");

  assert.deepEqual(
    result.articles.map((a) => a.id),
    ["f1", "f2", "annot"],
  );
  assert.equal(result.hasMore, false);
});

// ---------------------------------------------------------------------------
// Page 2: annotation IDs must NOT be re-appended (regression test for #80)
// ---------------------------------------------------------------------------

test("searchPublishedArticles page 2 does not re-append annotation IDs", async () => {
  const { searchPublishedArticles } = await import("@/lib/articles");

  const f3 = buildArticle({ id: "f3" });
  const annot = buildArticle({ id: "annot" });

  // Simulate page 2 (offset=5): FTS returns only f3
  ftsRows = [{ id: "f3", rank: -0.5 }];
  articleDbRows = [f3, annot];
  // annot came from annotations on page 1 — must NOT reappear on page 2
  highlightRows = [{ articleId: "annot" }];

  const result = await searchPublishedArticles("hello", { offset: 5, limit: 3 }, "user-1");

  assert.deepEqual(
    result.articles.map((a) => a.id),
    ["f3"],
  );
  assert.equal(result.hasMore, false);
});

// ---------------------------------------------------------------------------
// hasMore computed correctly
// ---------------------------------------------------------------------------

test("searchPublishedArticles hasMore is true when FTS overflow exceeds limit", async () => {
  const { searchPublishedArticles } = await import("@/lib/articles");

  const arts = ["f1", "f2", "f3", "f4"].map((id) => buildArticle({ id }));
  articleDbRows = arts;
  // 4 FTS rows for limit=3: orderedIds.length(4) > limit(3) → hasMore=true
  ftsRows = [
    { id: "f1", rank: -2.0 },
    { id: "f2", rank: -1.5 },
    { id: "f3", rank: -1.0 },
    { id: "f4", rank: -0.5 },
  ];

  const result = await searchPublishedArticles("test", { offset: 0, limit: 3 });

  assert.equal(result.articles.length, 3);
  assert.equal(result.hasMore, true);
});

test("searchPublishedArticles hasMore is false when results fit within limit", async () => {
  const { searchPublishedArticles } = await import("@/lib/articles");

  articleDbRows = [buildArticle({ id: "f1" }), buildArticle({ id: "f2" })];
  ftsRows = [
    { id: "f1", rank: -1.5 },
    { id: "f2", rank: -1.0 },
  ];

  const result = await searchPublishedArticles("test", { offset: 0, limit: 5 });

  assert.equal(result.articles.length, 2);
  assert.equal(result.hasMore, false);
});

// ---------------------------------------------------------------------------
// FTS5 error fallback to LIKE
// ---------------------------------------------------------------------------

test("searchPublishedArticles falls back to LIKE when FTS5 throws", async () => {
  const { searchPublishedArticles } = await import("@/lib/articles");

  shouldThrowFts = true;
  const likeMatch = buildArticle({ id: "like-match", title: "hello world" });
  articleDbRows = [likeMatch];

  // LIKE path: article.findMany called without id.in → mock returns all rows
  const result = await searchPublishedArticles("hello", { offset: 0, limit: 10 });

  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].id, "like-match");
  assert.equal(result.hasMore, false);
});

// ---------------------------------------------------------------------------
// Empty / blank query
// ---------------------------------------------------------------------------

test("searchPublishedArticles returns empty for blank query without hitting DB", async () => {
  const { searchPublishedArticles } = await import("@/lib/articles");

  const result = await searchPublishedArticles("  ");

  assert.deepEqual(result.articles, []);
  assert.equal(result.hasMore, false);
});
