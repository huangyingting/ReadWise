/**
 * Tests for src/lib/admin/overview.ts — statusBadgeVariant (pure) and
 * getAdminOverview (Prisma queries). Covers all badge states and query
 * aggregation logic.
 */
import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

let userCount = 0;
let adminCount = 0;
let articleCount = 0;
let publishedCount = 0;
let tagCount = 0;
let readingProgressCount = 0;
let groupedResult: Array<{ status: string; _count: { _all: number } }> = [];

before(() => {
  mock.module("@prisma/client", {
    namedExports: {
      ArticleStatus: {
        DRAFT: "DRAFT",
        PROCESSING: "PROCESSING",
        PUBLISHED: "PUBLISHED",
        FAILED: "FAILED",
        ARCHIVED: "ARCHIVED",
      },
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        user: {
          count: async (opts?: { where?: Record<string, unknown> }) => {
            if (opts?.where?.role === "Admin") return adminCount;
            return userCount;
          },
        },
        article: {
          count: async (opts?: { where?: Record<string, unknown> }) => {
            if (opts?.where?.status === "PUBLISHED") return publishedCount;
            return articleCount;
          },
          groupBy: async () => groupedResult,
        },
        tag: { count: async () => tagCount },
        readingProgress: { count: async () => readingProgressCount },
      },
    },
  });
});

let overview: typeof import("@/lib/admin/overview");

beforeEach(async () => {
  userCount = 10;
  adminCount = 2;
  articleCount = 100;
  publishedCount = 80;
  tagCount = 15;
  readingProgressCount = 500;
  groupedResult = [
    { status: "PUBLISHED", _count: { _all: 80 } },
    { status: "DRAFT", _count: { _all: 15 } },
    { status: "FAILED", _count: { _all: 5 } },
  ];
  overview = await import("@/lib/admin/overview");
});

describe("statusBadgeVariant", () => {
  test("returns 'success' for PUBLISHED", () => {
    assert.equal(overview.statusBadgeVariant("PUBLISHED"), "success");
  });

  test("returns 'warning' for PROCESSING", () => {
    assert.equal(overview.statusBadgeVariant("PROCESSING"), "warning");
  });

  test("returns 'danger' for FAILED", () => {
    assert.equal(overview.statusBadgeVariant("FAILED"), "danger");
  });

  test("returns 'neutral' for DRAFT", () => {
    assert.equal(overview.statusBadgeVariant("DRAFT"), "neutral");
  });

  test("returns 'neutral' for ARCHIVED", () => {
    assert.equal(overview.statusBadgeVariant("ARCHIVED"), "neutral");
  });

  test("returns 'neutral' for unknown status", () => {
    assert.equal(overview.statusBadgeVariant("UNKNOWN"), "neutral");
  });
});

describe("getAdminOverview", () => {
  test("returns aggregated counts from prisma", async () => {
    const result = await overview.getAdminOverview();
    assert.equal(result.users, 10);
    assert.equal(result.admins, 2);
    assert.equal(result.articles, 100);
    assert.equal(result.published, 80);
    assert.equal(result.tags, 15);
    assert.equal(result.readingProgress, 500);
  });

  test("statusCounts are sorted descending by count", async () => {
    const result = await overview.getAdminOverview();
    assert.equal(result.statusCounts[0].status, "PUBLISHED");
    assert.equal(result.statusCounts[0].count, 80);
    assert.equal(result.statusCounts[1].status, "DRAFT");
    assert.equal(result.statusCounts[1].count, 15);
    assert.equal(result.statusCounts[2].status, "FAILED");
    assert.equal(result.statusCounts[2].count, 5);
  });

  test("handles empty groupBy result", async () => {
    groupedResult = [];
    const result = await overview.getAdminOverview();
    assert.deepEqual(result.statusCounts, []);
  });
});
