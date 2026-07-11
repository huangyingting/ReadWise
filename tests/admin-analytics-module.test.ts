process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let postgres = false;
let queryRawCount: bigint | number = 0;
let tagRecords: Array<{ slug: string; name: string; _count: { articles: number } }> = [];
let articleCategoryGroups: Array<{ category: string | null; _count: { _all: number } }> = [];
let articleLevelGroups: Array<{ difficulty: string | null; _count: { _all: number } }> = [];
let readingCountCompleted = 0;
let readingCountTotal = 0;
let tagFindManyArgs: Record<string, unknown> | null = null;

before(() => {
  mock.module("@/lib/db-utils", {
    namedExports: {
      isPostgresDatabase: () => postgres,
    },
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      publicListableArticleWhere: () => ({ published: true }),
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          groupBy: async ({ by }: { by: string[] }) =>
            by[0] === "category" ? articleCategoryGroups : articleLevelGroups,
        },
        user: {
          count: async () => 12,
        },
        readingProgress: {
          count: async (args?: { where?: { completed?: boolean } }) => {
            if (args?.where?.completed) return readingCountCompleted;
            return readingCountTotal;
          },
        },
        savedWord: {
          count: async () => 9,
        },
        tag: {
          findMany: async (args: Record<string, unknown>) => {
            tagFindManyArgs = args;
            return tagRecords;
          },
        },
        $queryRaw: async () => [{ count: queryRawCount }],
      },
    },
  });
});

beforeEach(() => {
  postgres = false;
  queryRawCount = 4;
  tagRecords = [
    { slug: "science", name: "Science", _count: { articles: 7 } },
    { slug: "empty", name: "Empty", _count: { articles: 0 } },
  ];
  articleCategoryGroups = [
    { category: "science", _count: { _all: 3 } },
    { category: null, _count: { _all: 2 } },
  ];
  articleLevelGroups = [
    { difficulty: "B1", _count: { _all: 5 } },
    { difficulty: null, _count: { _all: 1 } },
  ];
  readingCountTotal = 8;
  readingCountCompleted = 6;
  tagFindManyArgs = null;
});

test("admin analytics aggregates category/level buckets and member activity on sqlite", async () => {
  const { getAdminAnalytics } = await import("@/lib/analytics/admin");

  const analytics = await getAdminAnalytics();

  assert.equal(analytics.memberActivity.totalMembers, 12);
  assert.equal(analytics.memberActivity.activeReaders, 4);
  assert.equal(analytics.memberActivity.readsTracked, 8);
  assert.equal(analytics.memberActivity.completedReads, 6);
  assert.equal(analytics.memberActivity.savedWords, 9);

  const scienceBucket = analytics.articlesByCategory.find((bucket) => bucket.key === "science");
  const uncategorized = analytics.articlesByCategory.find((bucket) => bucket.key === "uncategorized");
  assert.equal(scienceBucket?.count, 3);
  assert.equal(uncategorized?.count, 2);

  const b1Bucket = analytics.articlesByLevel.find((bucket) => bucket.key === "B1");
  const unassessed = analytics.articlesByLevel.find((bucket) => bucket.key === "unassessed");
  assert.equal(b1Bucket?.count, 5);
  assert.equal(unassessed?.count, 1);

  assert.deepEqual(analytics.topTags, [{ key: "science", label: "Science", count: 7 }]);

  const where = tagFindManyArgs?.where as { scope?: string };
  assert.equal(where.scope, "PUBLIC");
});

test("admin analytics supports postgres distinct-user counts", async () => {
  const { getAdminAnalytics } = await import("@/lib/analytics/admin");

  postgres = true;
  queryRawCount = 11n;

  const analytics = await getAdminAnalytics();

  assert.equal(analytics.memberActivity.activeReaders, 11);
});
