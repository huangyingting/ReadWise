/**
 * Unit tests for the getArticleTitlesForWords read model extracted in REF-081.
 *
 * No real DB is touched — Prisma is mocked via node:test module mocking.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  ArticleStatus,
  ArticleVisibility,
  type Article,
} from "@prisma/client";
import { buildArticle } from "./helpers";

type FindArgs = {
  where?: Record<string, unknown>;
  select?: Record<string, boolean>;
};

let articleRows: Article[] = [];

function matchesWhere(row: Article, where: Record<string, unknown>): boolean {
  const idFilter = where?.id as Record<string, unknown> | undefined;
  if (idFilter && Array.isArray(idFilter.in)) {
    if (!idFilter.in.includes(row.id)) return false;
  }
  // Enforce DENIED_WHERE sentinel
  if (where?.id === "__readwise_article_access_denied__") return false;
  // Basic visibility/status/ownerId handling for readableArticleWhere
  const or = where?.OR as Array<Record<string, unknown>> | undefined;
  if (or) {
    return or.some((clause) => {
      const vis = clause.visibility;
      const st = clause.status;
      const own = clause.ownerId;
      const ownerId = "ownerId" in clause ? clause.ownerId : undefined;
      if (vis !== undefined && row.visibility !== vis) return false;
      if (st !== undefined && row.status !== st) return false;
      if ("ownerId" in clause && row.ownerId !== ownerId) return false;
      return true;
    });
  }
  // Operator context — no restrictions
  return true;
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findMany: async (args: FindArgs = {}) => {
            const where = args.where as Record<string, unknown> | undefined;
            if (!where) return articleRows;
            const filtered = articleRows.filter((row) => matchesWhere(row, where));
            // Return only selected fields
            if (args.select) {
              return filtered.map((row) => {
                const result: Record<string, unknown> = {};
                for (const key of Object.keys(args.select ?? {})) {
                  result[key] = (row as Record<string, unknown>)[key];
                }
                return result;
              });
            }
            return filtered;
          },
        },
        savedWord: {
          findMany: async () => [],
          upsert: async () => ({}),
          deleteMany: async () => ({}),
          count: async () => 0,
        },
      },
    },
  });
});

beforeEach(() => {
  articleRows = [];
});

test("getArticleTitlesForWords returns title map for readable articles", async () => {
  const { getArticleTitlesForWords } = await import("@/lib/lexical/saved-words");
  articleRows = [
    buildArticle({ id: "a1", title: "Article One" }),
    buildArticle({ id: "a2", title: "Article Two" }),
  ];

  const result = await getArticleTitlesForWords(["a1", "a2"], { role: "Admin" });

  assert.deepEqual(result, { a1: "Article One", a2: "Article Two" });
});

test("getArticleTitlesForWords returns empty object for empty articleIds", async () => {
  const { getArticleTitlesForWords } = await import("@/lib/lexical/saved-words");
  articleRows = [buildArticle({ id: "a1", title: "Article One" })];

  const result = await getArticleTitlesForWords([], { role: "Admin" });

  assert.deepEqual(result, {});
});

test("getArticleTitlesForWords omits articles the user cannot read", async () => {
  const { getArticleTitlesForWords } = await import("@/lib/lexical/saved-words");
  articleRows = [
    buildArticle({
      id: "public",
      title: "Public Article",
      visibility: ArticleVisibility.PUBLIC,
      status: ArticleStatus.PUBLISHED,
      ownerId: null,
    }),
    buildArticle({
      id: "private-other",
      title: "Private Other",
      visibility: ArticleVisibility.PRIVATE,
      ownerId: "other-user",
    }),
  ];

  // User context — can only read public published articles + their own private
  const result = await getArticleTitlesForWords(
    ["public", "private-other"],
    { userId: "user-1", role: "User" },
  );

  assert.deepEqual(result, { public: "Public Article" });
  assert.equal((result as Record<string, string | undefined>)["private-other"], undefined);
});

test("getArticleTitlesForWords includes user's own private articles", async () => {
  const { getArticleTitlesForWords } = await import("@/lib/lexical/saved-words");
  articleRows = [
    buildArticle({
      id: "mine",
      title: "My Import",
      visibility: ArticleVisibility.PRIVATE,
      ownerId: "user-1",
    }),
  ];

  const result = await getArticleTitlesForWords(
    ["mine"],
    { userId: "user-1", role: "User" },
  );

  assert.deepEqual(result, { mine: "My Import" });
});
