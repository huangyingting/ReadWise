/**
 * Unit tests for the portable article search provider.
 *
 * No real DB/FTS index is touched. The Prisma mock intentionally omits
 * `$queryRaw`, so any regression to SQLite FTS5 fails these tests.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  ArticleStatus,
  ArticleVisibility,
  type Article,
  type Prisma,
} from "@prisma/client";
import { buildArticle } from "./helpers";

type FindArgs = {
  where?: Record<string, unknown>;
  orderBy?: Array<Record<string, "asc" | "desc">>;
  take?: number;
};

type HighlightRow = { userId: string; articleId: string; quote: string; note?: string | null };
type SavedWordRow = {
  userId: string;
  articleId: string | null;
  word: string;
  explanation?: string | null;
  example?: string | null;
  contextSentence?: string | null;
};

let articleRows: Article[] = [];
let highlightRows: HighlightRow[] = [];
let savedWordRows: SavedWordRow[] = [];
let articleFindCalls: FindArgs[] = [];
let highlightFindCalls: FindArgs[] = [];
let savedWordFindCalls: FindArgs[] = [];

function valueFor(row: unknown, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function contains(actual: unknown, expected: unknown): boolean {
  return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
}

function matchesWhere(row: unknown, where: Record<string, unknown> = {}): boolean {
  const and = where.AND;
  if (Array.isArray(and) && !and.every((clause) => matchesWhere(row, clause as Record<string, unknown>))) {
    return false;
  }
  const or = where.OR;
  if (Array.isArray(or) && !or.some((clause) => matchesWhere(row, clause as Record<string, unknown>))) {
    return false;
  }

  for (const [key, expected] of Object.entries(where)) {
    if (key === "AND" || key === "OR") continue;
    const actual = valueFor(row, key);
    if (expected && typeof expected === "object") {
      const filter = expected as Record<string, unknown>;
      if (Array.isArray(filter.in)) {
        if (!filter.in.includes(actual)) return false;
        continue;
      }
      if ("not" in filter) {
        if (actual === filter.not) return false;
        continue;
      }
      if ("contains" in filter) {
        if (!contains(actual, filter.contains)) return false;
        continue;
      }
    }
    if (actual !== expected) return false;
  }
  return true;
}

function sortArticles(rows: Article[], orderBy: FindArgs["orderBy"]): Article[] {
  if (!orderBy) return rows;
  return [...rows].sort((a, b) => {
    for (const order of orderBy) {
      const [field, direction] = Object.entries(order)[0] as [keyof Article, "asc" | "desc"];
      const av = a[field] instanceof Date ? (a[field] as Date).getTime() : a[field];
      const bv = b[field] instanceof Date ? (b[field] as Date).getTime() : b[field];
      if (av === bv) continue;
      const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : 1;
      return direction === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findMany: async (args: FindArgs = {}) => {
            articleFindCalls.push(args);
            const matched = articleRows.filter((row) => matchesWhere(row, args.where));
            const sorted = sortArticles(matched, args.orderBy);
            return typeof args.take === "number" ? sorted.slice(0, args.take) : sorted;
          },
          count: async (args: Pick<FindArgs, "where"> = {}) => {
            return articleRows.filter((row) => matchesWhere(row, args.where)).length;
          },
        },
        highlight: {
          findMany: async (args: FindArgs = {}) => {
            highlightFindCalls.push(args);
            const matched = highlightRows.filter((row) => matchesWhere(row, args.where));
            return matched.map((row) => ({ articleId: row.articleId }));
          },
        },
        savedWord: {
          findMany: async (args: FindArgs = {}) => {
            savedWordFindCalls.push(args);
            const matched = savedWordRows.filter((row) => matchesWhere(row, args.where));
            return matched.map((row) => ({ articleId: row.articleId }));
          },
        },
      },
    },
  });
});

beforeEach(() => {
  articleRows = [];
  highlightRows = [];
  savedWordRows = [];
  articleFindCalls = [];
  highlightFindCalls = [];
  savedWordFindCalls = [];
});

test("buildSearchTerms normalizes punctuation and deduplicates", async () => {
  const { buildSearchTerms } = await import("@/lib/article-search");

  assert.deepEqual(buildSearchTerms("  Climate, climate-change!  "), ["climate", "change"]);
  assert.deepEqual(buildSearchTerms("   "), []);
});

test("search ranks title matches ahead of body/source matches and then by recency", async () => {
  const { searchReadableArticles } = await import("@/lib/article-search");
  articleRows = [
    buildArticle({ id: "body", title: "Other", content: "climate", publishedAt: new Date("2026-01-03") }),
    buildArticle({ id: "title-old", title: "Climate policy", publishedAt: new Date("2026-01-01") }),
    buildArticle({ id: "title-new", title: "Climate science", publishedAt: new Date("2026-01-02") }),
  ];

  const result = await searchReadableArticles("climate", { limit: 3 });

  assert.deepEqual(result.articles.map((a) => a.id), ["title-new", "title-old", "body"]);
  assert.equal(result.hasMore, false);
});

test("older title matches are not hidden behind the recency-capped body candidate window", async () => {
  const { searchReadableArticles } = await import("@/lib/article-search");
  articleRows = [
    ...Array.from({ length: 30 }, (_, index) =>
      buildArticle({
        id: `source-${index}`,
        title: `Recent source match ${index}`,
        source: "Xenolith Daily",
        content: "no matching body text",
        publishedAt: new Date(`2026-04-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`),
      }),
    ),
    ...Array.from({ length: 75 }, (_, index) =>
      buildArticle({
        id: `body-${index}`,
        title: `Recent body match ${index}`,
        content: "xenolith appears in the body",
        publishedAt: new Date(`2026-03-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`),
      }),
    ),
    buildArticle({
      id: "older-title",
      title: "Xenolith field guide",
      content: "no matching body text",
      publishedAt: new Date("2020-01-01T00:00:00Z"),
    }),
  ];

  const result = await searchReadableArticles("xenolith");

  assert.equal(result.articles[0].id, "older-title");
  assert.ok(result.articles.some((article) => article.id === "older-title"));
  assert.equal(result.hasMore, true);
});

test("search returns empty for blank query without touching Prisma", async () => {
  const { searchReadableArticles } = await import("@/lib/article-search");

  const result = await searchReadableArticles("  ");

  assert.deepEqual(result, { articles: [], hasMore: false });
  assert.equal(articleFindCalls.length, 0);
  assert.equal(highlightFindCalls.length, 0);
  assert.equal(savedWordFindCalls.length, 0);
});

test("anonymous/public search never leaks owned or draft articles", async () => {
  const { searchReadableArticles } = await import("@/lib/article-search");
  articleRows = [
    buildArticle({ id: "public", title: "Climate", ownerId: null, status: ArticleStatus.PUBLISHED }),
    buildArticle({
      id: "owned",
      title: "Climate private",
      ownerId: "user-1",
      visibility: ArticleVisibility.PRIVATE,
      status: ArticleStatus.PUBLISHED,
    }),
    buildArticle({ id: "draft", title: "Climate draft", ownerId: null, status: ArticleStatus.DRAFT }),
  ];

  const result = await searchReadableArticles("climate", { limit: 10 });

  assert.deepEqual(result.articles.map((a) => a.id), ["public"]);
  assert.equal(highlightFindCalls.length, 0, "anonymous search must not query user annotations");
});

test("authenticated search includes the user's own private imports but not another user's imports", async () => {
  const { searchReadableArticles } = await import("@/lib/article-search");
  articleRows = [
    buildArticle({ id: "public", title: "Import guide", ownerId: null, status: ArticleStatus.PUBLISHED }),
    buildArticle({
      id: "mine",
      title: "Import notes",
      ownerId: "user-1",
      visibility: ArticleVisibility.PRIVATE,
      status: ArticleStatus.DRAFT,
    }),
    buildArticle({
      id: "theirs",
      title: "Import secret",
      ownerId: "user-2",
      visibility: ArticleVisibility.PRIVATE,
      status: ArticleStatus.PUBLISHED,
    }),
  ];

  const result = await searchReadableArticles("import", { limit: 10 }, "user-1");

  assert.deepEqual(result.articles.map((a) => a.id), ["mine", "public"]);
});

test("highlight/note matches are scoped to the requesting user and final article readability", async () => {
  const { searchReadableArticles } = await import("@/lib/article-search");
  articleRows = [
    buildArticle({
      id: "mine",
      title: "Private article",
      ownerId: "user-1",
      visibility: ArticleVisibility.PRIVATE,
      status: ArticleStatus.DRAFT,
    }),
    buildArticle({
      id: "theirs",
      title: "Other article",
      ownerId: "user-2",
      visibility: ArticleVisibility.PRIVATE,
      status: ArticleStatus.PUBLISHED,
    }),
  ];
  highlightRows = [
    { userId: "user-1", articleId: "mine", quote: "mitochondria" },
    { userId: "user-2", articleId: "theirs", quote: "mitochondria" },
  ];

  const result = await searchReadableArticles("mitochondria", { limit: 10 }, "user-1");

  assert.deepEqual(result.articles.map((a) => a.id), ["mine"]);
  assert.equal(highlightFindCalls[0].where?.userId, "user-1");
});

test("saved vocabulary matches can surface readable articles", async () => {
  const { searchReadableArticles } = await import("@/lib/article-search");
  articleRows = [buildArticle({ id: "article", title: "General news", ownerId: null, status: ArticleStatus.PUBLISHED })];
  savedWordRows = [{ userId: "user-1", articleId: "article", word: "photosynthesis" }];

  const result = await searchReadableArticles("photosynthesis", { limit: 10 }, "user-1");

  assert.deepEqual(result.articles.map((a) => a.id), ["article"]);
  assert.equal(savedWordFindCalls[0].where?.userId, "user-1");
});

test("search paginates ranked candidates and reports hasMore", async () => {
  const { searchReadableArticles } = await import("@/lib/article-search");
  articleRows = ["a1", "a2", "a3"].map((id, index) =>
    buildArticle({ id, title: `Climate ${id}`, publishedAt: new Date(`2026-01-0${3 - index}T00:00:00Z`) }),
  );

  const page1 = await searchReadableArticles("climate", { offset: 0, limit: 2 });
  const page2 = await searchReadableArticles("climate", { offset: 2, limit: 2 });

  assert.deepEqual(page1.articles.map((a) => a.id), ["a1", "a2"]);
  assert.equal(page1.hasMore, true);
  assert.deepEqual(page2.articles.map((a) => a.id), ["a3"]);
  assert.equal(page2.hasMore, false);
});

test("search does not report hasMore after the capped broad candidate window is exhausted", async () => {
  const { SEARCH_CANDIDATE_LIMIT, searchReadableArticles } = await import("@/lib/article-search");
  articleRows = Array.from({ length: SEARCH_CANDIDATE_LIMIT + 25 }, (_, index) =>
    buildArticle({
      id: `broad-${index}`,
      title: `Climate broad match ${index}`,
      publishedAt: new Date(`2026-02-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`),
    }),
  );

  const page = await searchReadableArticles("climate", { offset: SEARCH_CANDIDATE_LIMIT, limit: 20 });

  assert.deepEqual(page.articles, []);
  assert.equal(page.hasMore, false);
});
