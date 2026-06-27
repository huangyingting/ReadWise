/**
 * IDOR / visibility regression tests for the Recommendations candidate set.
 *
 * Verifies that `listScoredPicksPage` only ever surfaces articles that pass
 * `publicListableArticleWhere` (visibility=PUBLIC, status=PUBLISHED,
 * ownerId=null). Private imports, owned-public articles, drafts, and
 * another user's private articles must never become recommendation candidates.
 *
 * Phase 3 — issue #688.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { ArticleStatus, ArticleVisibility, type Article } from "@prisma/client";
import { buildArticle } from "./helpers";

// ---------------------------------------------------------------------------
// Filtering mock — simulates Prisma equality and in-array WHERE evaluation.
// Covers the equality checks emitted by publicListableArticleWhere().
// ---------------------------------------------------------------------------

type FindArgs = {
  where?: Record<string, unknown>;
  orderBy?: unknown;
  take?: number;
  select?: unknown;
};

function matchesWhere(row: unknown, where: Record<string, unknown> = {}): boolean {
  const record = row as Record<string, unknown>;
  if (Array.isArray(where.AND)) {
    if (!(where.AND as Array<Record<string, unknown>>).every((c) => matchesWhere(row, c))) {
      return false;
    }
  }
  if (Array.isArray(where.OR)) {
    if (!(where.OR as Array<Record<string, unknown>>).some((c) => matchesWhere(row, c))) {
      return false;
    }
  }
  for (const [key, expected] of Object.entries(where)) {
    if (key === "AND" || key === "OR") continue;
    const actual = record[key];
    if (expected !== null && typeof expected === "object" && "in" in (expected as object)) {
      if (!(expected as { in: unknown[] }).in.includes(actual)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Mutable stub state
// ---------------------------------------------------------------------------

let articleRows: Article[] = [];
let articleTagRows: Array<{ articleId: string; tag: { slug: string } }> = [];

before(() => {
  // Bypass the Next.js cache so loadPicksCandidates runs synchronously in tests.
  mock.module("@/lib/cache", {
    namedExports: {
      ARTICLES_CACHE_TAG: "articles",
      TAGS_CACHE_TAG: "tags",
      createCachedListing: (fn: (...args: never[]) => unknown) => fn,
    },
  });

  // Prisma mock: article.findMany applies the WHERE clause so visibility rules
  // are exercised. Context tables (profile, mastery, progress, vocab) return
  // neutral/empty values to keep scoring on the graceful new-user path.
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findMany: async (args: FindArgs = {}) => {
            const filtered = articleRows.filter((row) =>
              matchesWhere(row, (args.where as Record<string, unknown>) ?? {}),
            );
            return typeof args.take === "number" ? filtered.slice(0, args.take) : filtered;
          },
        },
        articleTag: {
          findMany: async () => articleTagRows,
        },
        profile: {
          findUnique: async () => null,
        },
        articleDifficultyFeedback: {
          groupBy: async () => [],
        },
        quizAttempt: {
          findMany: async () => [],
        },
        readingProgress: {
          count: async () => 0,
          findMany: async () => [],
        },
        skillMastery: {
          findMany: async () => [],
        },
        wordMastery: {
          aggregate: async () => ({ _avg: { familiarity: null }, _count: { _all: 0 } }),
          findMany: async () => [],
        },
        articleMastery: {
          findMany: async () => [],
        },
      },
    },
  });

  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => false,
      aiModelName: () => null,
      chatComplete: async () => null,
    },
  });
});

beforeEach(() => {
  articleRows = [];
  articleTagRows = [];
});

// ---------------------------------------------------------------------------
// IDOR / visibility regression tests
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-26T00:00:00Z");

test("IDOR: private imported article (PRIVATE, owned) is never a recommendation candidate", async () => {
  const { listScoredPicksPage } = await import("@/lib/recommendations/picks");

  articleRows = [
    buildArticle({ id: "public", visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.PUBLISHED, ownerId: null, publishedAt: NOW }),
    buildArticle({ id: "private-import", visibility: ArticleVisibility.PRIVATE, status: ArticleStatus.PUBLISHED, ownerId: "user-1", publishedAt: NOW }),
  ];

  const page = await listScoredPicksPage("user-1", { limit: 10 });
  assert.deepEqual(
    page.articles.map((a) => a.id),
    ["public"],
    "private imported article must never be a recommendation candidate",
  );
});

test("IDOR: another user's private article is never a recommendation candidate", async () => {
  const { listScoredPicksPage } = await import("@/lib/recommendations/picks");

  articleRows = [
    buildArticle({ id: "public", visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.PUBLISHED, ownerId: null, publishedAt: NOW }),
    buildArticle({ id: "user2-private", visibility: ArticleVisibility.PRIVATE, status: ArticleStatus.PUBLISHED, ownerId: "user-2", publishedAt: NOW }),
  ];

  const page = await listScoredPicksPage("user-1", { limit: 10 });
  assert.deepEqual(
    page.articles.map((a) => a.id),
    ["public"],
    "another user's private article must never be a recommendation candidate",
  );
});

test("IDOR: draft article (PUBLIC but DRAFT status) is never a recommendation candidate", async () => {
  const { listScoredPicksPage } = await import("@/lib/recommendations/picks");

  articleRows = [
    buildArticle({ id: "published", visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.PUBLISHED, ownerId: null, publishedAt: NOW }),
    buildArticle({ id: "draft", visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.DRAFT, ownerId: null, publishedAt: NOW }),
  ];

  const page = await listScoredPicksPage("user-1", { limit: 10 });
  assert.deepEqual(
    page.articles.map((a) => a.id),
    ["published"],
    "draft article must never be a recommendation candidate",
  );
});

test("IDOR: owned-public article (PUBLIC but ownerId set) is never a recommendation candidate", async () => {
  const { listScoredPicksPage } = await import("@/lib/recommendations/picks");

  // An article can be PUBLIC+PUBLISHED but still owner-linked (e.g. imported
  // by admin and set public). The library predicate requires ownerId=null.
  articleRows = [
    buildArticle({ id: "library", visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.PUBLISHED, ownerId: null, publishedAt: NOW }),
    buildArticle({ id: "owned-public", visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.PUBLISHED, ownerId: "admin-user", publishedAt: NOW }),
  ];

  const page = await listScoredPicksPage("user-1", { limit: 10 });
  assert.deepEqual(
    page.articles.map((a) => a.id),
    ["library"],
    "owned-public article must never be a recommendation candidate",
  );
});

test("IDOR: candidate set is user-agnostic — same public-only articles for every user", async () => {
  const { listScoredPicksPage } = await import("@/lib/recommendations/picks");

  articleRows = [
    buildArticle({ id: "lib-a", visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.PUBLISHED, ownerId: null, publishedAt: new Date("2026-06-25T00:00:00Z") }),
    buildArticle({ id: "lib-b", visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.PUBLISHED, ownerId: null, publishedAt: new Date("2026-06-24T00:00:00Z") }),
    // Non-candidates that must be absent for all users
    buildArticle({ id: "u1-private", visibility: ArticleVisibility.PRIVATE, status: ArticleStatus.PUBLISHED, ownerId: "user-1", publishedAt: NOW }),
    buildArticle({ id: "u2-private", visibility: ArticleVisibility.PRIVATE, status: ArticleStatus.PUBLISHED, ownerId: "user-2", publishedAt: NOW }),
    buildArticle({ id: "draft", visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.DRAFT, ownerId: null, publishedAt: NOW }),
  ];

  const pageUser1 = await listScoredPicksPage("user-1", { limit: 20 });
  const pageUser2 = await listScoredPicksPage("user-2", { limit: 20 });

  const ids1 = pageUser1.articles.map((a) => a.id).sort();
  const ids2 = pageUser2.articles.map((a) => a.id).sort();
  const expected = ["lib-a", "lib-b"].sort();

  assert.deepEqual(ids1, expected, "user-1: only public library articles are candidates");
  assert.deepEqual(ids2, expected, "user-2: candidate set is identical (user-agnostic)");
});

test("recommendations: empty page when no public library articles exist", async () => {
  const { listScoredPicksPage } = await import("@/lib/recommendations/picks");

  // Only private/draft articles — no candidates should surface
  articleRows = [
    buildArticle({ id: "priv", visibility: ArticleVisibility.PRIVATE, status: ArticleStatus.PUBLISHED, ownerId: "user-1", publishedAt: NOW }),
    buildArticle({ id: "draft", visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.DRAFT, ownerId: null, publishedAt: NOW }),
  ];

  const page = await listScoredPicksPage("user-1", { limit: 10 });
  assert.deepEqual(page.articles, [], "no candidates → empty page");
  assert.equal(page.hasMore, false);
});
