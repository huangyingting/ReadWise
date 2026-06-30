process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { buildArticle } from "./helpers";
import {
  ArticleStatus,
  ArticleVisibility,
  type Article,
} from "@prisma/client";

type ArticleWhere = {
  id?: string;
  status?: string;
  visibility?: string;
  ownerId?: string | null;
  sourceUrl?: string | { in?: string[] };
  OR?: Array<{ status?: string; visibility?: string; ownerId?: string | null }>;
};

let articles: Article[] = [];
let findFirstWhere: ArticleWhere | null = null;
let findUniqueWhere: ArticleWhere | null = null;
let findManyWheres: ArticleWhere[] = [];

function matchesWhere(article: Article, where: ArticleWhere): boolean {
  if (where.id !== undefined && article.id !== where.id) return false;
  if (where.status !== undefined && article.status !== where.status) return false;
  if (where.visibility !== undefined && article.visibility !== where.visibility) return false;
  if (where.ownerId !== undefined && article.ownerId !== where.ownerId) return false;
  if (where.sourceUrl !== undefined) {
    if (typeof where.sourceUrl === "object") {
      if (!(where.sourceUrl.in ?? []).includes(article.sourceUrl ?? "")) return false;
    } else if (article.sourceUrl !== where.sourceUrl) {
      return false;
    }
  }
  if (where.OR) {
    return where.OR.some((clause) => matchesWhere(article, clause));
  }
  return true;
}

function projectArticle(article: Article, select?: Record<string, boolean>): unknown {
  if (!select) return article;
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, include]) => include)
      .map(([key]) => [key, (article as unknown as Record<string, unknown>)[key]]),
  );
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findFirst: async (args: { where: ArticleWhere }) => {
            findFirstWhere = args.where;
            return articles.find((article) => matchesWhere(article, args.where)) ?? null;
          },
          findUnique: async (args: { where: ArticleWhere }) => {
            findUniqueWhere = args.where;
            return articles.find((article) => matchesWhere(article, args.where)) ?? null;
          },
          findMany: async (args: { where: ArticleWhere; select?: Record<string, boolean> }) => {
            findManyWheres.push(args.where);
            return articles
              .filter((article) => matchesWhere(article, args.where))
              .map((article) => projectArticle(article, args.select));
          },
        },
      },
    },
  });

  mock.module("@/lib/cache", {
    namedExports: {
      createCachedListing:
        <T extends unknown[], R>(fn: (...args: T) => Promise<R>) =>
        (...args: T) =>
          fn(...args),
      ARTICLES_CACHE_TAG: "articles",
    },
  });

  mock.module("@/lib/difficulty", {
    namedExports: {
      levelRank: () => 0,
      levelsAtOrBelow: () => ["A1"],
      ensureArticleDifficulties: async () => {},
    },
  });
});

beforeEach(() => {
  articles = [
    buildArticle({ id: "public-published", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PUBLIC, ownerId: null }),
    buildArticle({ id: "owned-public", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PUBLIC, ownerId: "user-1" }),
    buildArticle({ id: "owner-private", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PRIVATE, ownerId: "user-1" }),
    buildArticle({ id: "foreign-private", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PRIVATE, ownerId: "user-2" }),
    buildArticle({ id: "public-draft", status: ArticleStatus.DRAFT, visibility: ArticleVisibility.PUBLIC, ownerId: null }),
  ];
  findFirstWhere = null;
  findUniqueWhere = null;
  findManyWheres = [];
});

test("getViewableArticleById scopes readers to public published or self-owned articles", async () => {
  const { getReadableArticleById } = await import("@/lib/article-library/policy");

  const owned = await getReadableArticleById("owner-private", { role: "Reader", userId: "user-1" });
  assert.equal(owned?.id, "owner-private");
  assert.deepEqual(findFirstWhere, {
    id: "owner-private",
    OR: [
      { visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.PUBLISHED, ownerId: null },
      { visibility: ArticleVisibility.PRIVATE, ownerId: "user-1" },
    ],
  });

  const foreign = await getReadableArticleById("foreign-private", { role: "Reader", userId: "user-1" });
  assert.equal(foreign, null);
});

test("getViewableArticleById hides private and draft articles from anonymous users", async () => {
  const { getReadableArticleById } = await import("@/lib/article-library/policy");

  assert.equal(await getReadableArticleById("foreign-private"), null);
  assert.deepEqual(findFirstWhere, {
    id: "foreign-private",
    visibility: ArticleVisibility.PUBLIC,
    status: ArticleStatus.PUBLISHED,
    ownerId: null,
  });

  assert.equal(await getReadableArticleById("public-draft"), null);
});

test("getViewableArticleById excludes owner-linked public articles from public library access", async () => {
  const { getReadableArticleById } = await import("@/lib/article-library/policy");

  assert.equal(await getReadableArticleById("owned-public", { role: "Reader", userId: "user-1" }), null);
  assert.deepEqual(findFirstWhere, {
    id: "owned-public",
    OR: [
      { visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.PUBLISHED, ownerId: null },
      { visibility: ArticleVisibility.PRIVATE, ownerId: "user-1" },
    ],
  });
});

test("getViewableArticleById lets admins resolve private and draft article ids", async () => {
  const { getReadableArticleById } = await import("@/lib/article-library/policy");

  const privateArticle = await getReadableArticleById("foreign-private", { role: "Admin", userId: "admin-1" });
  assert.equal(privateArticle?.id, "foreign-private");
  assert.deepEqual(findFirstWhere, { id: "foreign-private" });

  const draft = await getReadableArticleById("public-draft", { role: "Admin", userId: "admin-1" });
  assert.equal(draft?.id, "public-draft");
});

test("findExistingPublicLibrarySourceUrls returns only existing public-library URLs", async () => {
  articles.push(
    buildArticle({
      id: "existing-b",
      sourceUrl: "https://example.com/b",
      visibility: ArticleVisibility.PUBLIC,
      ownerId: null,
    }),
  );
  const { findExistingPublicLibrarySourceUrls } = await import("@/lib/article-library/policy");

  const existing = await findExistingPublicLibrarySourceUrls([
    "https://example.com/a",
    "https://example.com/new",
    "https://example.com/b",
    "https://example.com/a",
  ]);

  assert.deepEqual([...existing].sort(), ["https://example.com/a", "https://example.com/b"]);
  assert.equal(findManyWheres.length, 1);
  assert.deepEqual(findManyWheres[0], {
    sourceUrl: {
      in: ["https://example.com/a", "https://example.com/new", "https://example.com/b"],
    },
    visibility: ArticleVisibility.PUBLIC,
    ownerId: null,
  });
});

test("findExistingPublicLibrarySourceUrls returns an empty set without querying for empty input", async () => {
  const { findExistingPublicLibrarySourceUrls } = await import("@/lib/article-library/policy");

  const existing = await findExistingPublicLibrarySourceUrls([]);

  assert.equal(existing.size, 0);
  assert.equal(findManyWheres.length, 0);
});

test("findExistingPublicLibrarySourceUrls ignores owned or non-public rows with the same URL", async () => {
  articles = [
    buildArticle({
      id: "owned-public-url",
      sourceUrl: "https://example.com/owned",
      visibility: ArticleVisibility.PUBLIC,
      ownerId: "user-1",
    }),
    buildArticle({
      id: "private-url",
      sourceUrl: "https://example.com/private",
      visibility: ArticleVisibility.PRIVATE,
      ownerId: "user-1",
    }),
  ];
  const { findExistingPublicLibrarySourceUrls } = await import("@/lib/article-library/policy");

  const existing = await findExistingPublicLibrarySourceUrls([
    "https://example.com/owned",
    "https://example.com/private",
  ]);

  assert.equal(existing.size, 0);
  assert.deepEqual(findManyWheres[0], {
    sourceUrl: {
      in: ["https://example.com/owned", "https://example.com/private"],
    },
    visibility: ArticleVisibility.PUBLIC,
    ownerId: null,
  });
});

test("findExistingPublicLibrarySourceUrls chunks large inputs", async () => {
  const urls = Array.from({ length: 501 }, (_, index) => `https://example.com/chunk-${index}`);
  articles.push(
    buildArticle({
      id: "chunk-0",
      sourceUrl: urls[0],
      visibility: ArticleVisibility.PUBLIC,
      ownerId: null,
    }),
    buildArticle({
      id: "chunk-500",
      sourceUrl: urls[500],
      visibility: ArticleVisibility.PUBLIC,
      ownerId: null,
    }),
  );
  const { findExistingPublicLibrarySourceUrls } = await import("@/lib/article-library/policy");

  const existing = await findExistingPublicLibrarySourceUrls(urls);

  assert.deepEqual([...existing].sort(), [urls[0], urls[500]].sort());
  assert.equal(findManyWheres.length, 2);
  assert.equal((findManyWheres[0].sourceUrl as { in: string[] }).in.length, 500);
  assert.deepEqual((findManyWheres[1].sourceUrl as { in: string[] }).in, [urls[500]]);
});
