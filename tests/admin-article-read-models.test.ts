/**
 * Unit tests for the admin article page read models extracted in REF-081.
 *
 * No real DB is touched — Prisma is mocked via node:test module mocking.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  ArticleStatus,
  ArticleVisibility,
  ArticleSourceType,
  type Article,
} from "@prisma/client";
import { buildArticle } from "./helpers";

type FindArgs = {
  where?: Record<string, unknown>;
  distinct?: string[];
  select?: Record<string, boolean>;
  orderBy?: Record<string, string> | Array<Record<string, string>>;
};

let articleRows: Article[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findMany: async (args: FindArgs = {}) => {
            // Apply basic where filtering for the DENIED_WHERE sentinel
            const where = args.where as Record<string, unknown> | undefined;
            if (where?.id === "__readwise_article_access_denied__") {
              return [];
            }
            const rows = articleRows;
            // If distinct by status is requested, return unique statuses
            if (args.distinct?.includes("status")) {
              const seen = new Set<string>();
              const unique: Pick<Article, "status">[] = [];
              for (const row of rows) {
                if (!seen.has(row.status)) {
                  seen.add(row.status);
                  unique.push({ status: row.status });
                }
              }
              unique.sort((a, b) => a.status.localeCompare(b.status));
              return unique;
            }
            return rows;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  articleRows = [];
});

test("getAdminArticleStatuses returns distinct statuses for admin context", async () => {
  const { getAdminArticleStatuses } = await import("@/lib/article-library/admin");
  articleRows = [
    buildArticle({ id: "a1", status: ArticleStatus.PUBLISHED }),
    buildArticle({ id: "a2", status: ArticleStatus.DRAFT }),
    buildArticle({ id: "a3", status: ArticleStatus.PUBLISHED }),
    buildArticle({ id: "a4", status: ArticleStatus.PROCESSING }),
  ];

  const statuses = await getAdminArticleStatuses({ role: "Admin" });

  // Should return distinct statuses, sorted alphabetically
  assert.ok(statuses.includes("PUBLISHED"), "should include PUBLISHED");
  assert.ok(statuses.includes("DRAFT"), "should include DRAFT");
  assert.ok(statuses.includes("PROCESSING"), "should include PROCESSING");
  // Deduplication: PUBLISHED appears twice but should only be in result once
  assert.equal(statuses.filter((s) => s === "PUBLISHED").length, 1);
});

test("getAdminArticleStatuses returns empty array when no articles exist", async () => {
  const { getAdminArticleStatuses } = await import("@/lib/article-library/admin");
  articleRows = [];

  const statuses = await getAdminArticleStatuses({ role: "Admin" });

  assert.deepEqual(statuses, []);
});

test("getAdminArticleStatuses returns empty array for non-admin context", async () => {
  const { getAdminArticleStatuses } = await import("@/lib/article-library/admin");
  articleRows = [buildArticle({ id: "a1", status: ArticleStatus.PUBLISHED })];

  // Non-admin, non-system role → adminVisibleArticleWhere returns DENIED_WHERE
  const statuses = await getAdminArticleStatuses({ role: "User", userId: "user-1" });

  assert.deepEqual(statuses, []);
});

test("getAdminArticleStatuses uses System context by default", async () => {
  const { getAdminArticleStatuses } = await import("@/lib/article-library/admin");
  articleRows = [
    buildArticle({ id: "a1", status: ArticleStatus.PUBLISHED }),
    buildArticle({ id: "a2", status: ArticleStatus.DRAFT }),
  ];

  // Calling without explicit context uses SYSTEM_ARTICLE_CONTEXT (role: "System")
  const statuses = await getAdminArticleStatuses();

  assert.ok(statuses.includes("PUBLISHED"));
  assert.ok(statuses.includes("DRAFT"));
});
