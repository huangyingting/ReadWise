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
  OR?: Array<{ status?: string; visibility?: string; ownerId?: string | null }>;
};

let articles: Article[] = [];
let findFirstWhere: ArticleWhere | null = null;
let findUniqueWhere: ArticleWhere | null = null;

function matchesWhere(article: Article, where: ArticleWhere): boolean {
  if (where.id !== undefined && article.id !== where.id) return false;
  if (where.status !== undefined && article.status !== where.status) return false;
  if (where.visibility !== undefined && article.visibility !== where.visibility) return false;
  if (where.ownerId !== undefined && article.ownerId !== where.ownerId) return false;
  if (where.OR) {
    return where.OR.some((clause) => matchesWhere(article, clause));
  }
  return true;
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
    buildArticle({ id: "owner-private", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PRIVATE, ownerId: "user-1" }),
    buildArticle({ id: "foreign-private", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PRIVATE, ownerId: "user-2" }),
    buildArticle({ id: "public-draft", status: ArticleStatus.DRAFT, visibility: ArticleVisibility.PUBLIC, ownerId: null }),
  ];
  findFirstWhere = null;
  findUniqueWhere = null;
});

test("getViewableArticleById scopes readers to public published or self-owned articles", async () => {
  const { getViewableArticleById } = await import("@/lib/articles");

  const owned = await getViewableArticleById("owner-private", "Reader", "user-1");
  assert.equal(owned?.id, "owner-private");
  assert.deepEqual(findFirstWhere, {
    id: "owner-private",
    OR: [
      { visibility: ArticleVisibility.PUBLIC, status: ArticleStatus.PUBLISHED },
      { visibility: ArticleVisibility.PRIVATE, ownerId: "user-1" },
    ],
  });

  const foreign = await getViewableArticleById("foreign-private", "Reader", "user-1");
  assert.equal(foreign, null);
});

test("getViewableArticleById hides private and draft articles from anonymous users", async () => {
  const { getViewableArticleById } = await import("@/lib/articles");

  assert.equal(await getViewableArticleById("foreign-private"), null);
  assert.deepEqual(findFirstWhere, {
    id: "foreign-private",
    visibility: ArticleVisibility.PUBLIC,
    status: ArticleStatus.PUBLISHED,
  });

  assert.equal(await getViewableArticleById("public-draft"), null);
});

test("getViewableArticleById lets admins resolve private and draft article ids", async () => {
  const { getViewableArticleById } = await import("@/lib/articles");

  const privateArticle = await getViewableArticleById("foreign-private", "Admin", "admin-1");
  assert.equal(privateArticle?.id, "foreign-private");
  assert.deepEqual(findFirstWhere, { id: "foreign-private" });

  const draft = await getViewableArticleById("public-draft", "Admin", "admin-1");
  assert.equal(draft?.id, "public-draft");
});
