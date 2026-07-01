process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

type ArticleRow = {
  id: string;
  title: string;
  excerpt: string | null;
  category: string | null;
  difficulty: string | null;
  status: string;
  reviewState: string;
  qualityFlags: unknown;
  takedownState: string;
  publishedAt: Date | null;
};

let articles: Map<string, ArticleRow>;
let reviews: Array<Record<string, unknown>>;

before(() => {
  const article = {
    findUnique: async (args: { where: { id: string }; select?: Record<string, boolean> }) => {
      const row = articles.get(args.where.id) ?? null;
      if (!row || !args.select) return row;
      return Object.fromEntries(
        Object.entries(args.select)
          .filter(([, enabled]) => enabled)
          .map(([key]) => [key, (row as unknown as Record<string, unknown>)[key]]),
      );
    },
    update: async (args: { where: { id: string }; data: Partial<ArticleRow> }) => {
      const row = articles.get(args.where.id);
      if (!row) throw new Error("article not found");
      Object.assign(row, args.data);
      return row;
    },
  };
  const contentReview = {
    create: async (args: { data: Record<string, unknown> }) => {
      reviews.push(args.data);
      return { id: `review-${reviews.length}`, ...args.data };
    },
    findMany: async () => [],
  };

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article,
        contentReview,
        $transaction: async (fn: (tx: unknown) => unknown) => fn({ article, contentReview }),
      },
    },
  });
  mock.module("@/lib/article-library/collections", {
    namedExports: {
      getArticleTags: async () => [],
      setArticleTags: async () => [],
    },
  });
});

beforeEach(() => {
  articles = new Map([
    [
      "a1",
      {
        id: "a1",
        title: "Original title",
        excerpt: null,
        category: null,
        difficulty: null,
        status: "DRAFT",
        reviewState: "unreviewed",
        qualityFlags: "[]",
        takedownState: "active",
        publishedAt: null,
      },
    ],
  ]);
  reviews = [];
});

test("parseQualityFlags returns an empty list for malformed stored JSON", async () => {
  const { parseQualityFlags } = await import("@/lib/article-library/review");

  assert.deepEqual(parseQualityFlags("{not valid json"), []);
});

test("reviewArticle trims excerpt corrections and records equal-length quality flag changes", async () => {
  articles.get("a1")!.qualityFlags = "[\"thin_content\"]";
  const { reviewArticle } = await import("@/lib/article-library/review");

  const result = await reviewArticle({
    articleId: "a1",
    excerpt: "  Concise reviewed excerpt  ",
    qualityFlags: ["low_readability"],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(articles.get("a1")?.excerpt, "Concise reviewed excerpt");
  assert.deepEqual(articles.get("a1")?.qualityFlags, ["low_readability"]);
  assert.deepEqual(result.changes.excerpt, {
    from: null,
    to: "Concise reviewed excerpt",
  });
  assert.deepEqual(result.changes.qualityFlags, {
    from: ["thin_content"],
    to: ["low_readability"],
  });
  assert.equal(reviews.length, 1);
});

test("reviewArticle rejects an invalid review state", async () => {
  const { reviewArticle } = await import("@/lib/article-library/review");

  const result = await reviewArticle({
    articleId: "a1",
    reviewState: "queued" as never,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
  assert.equal(result.error, "Invalid review state");
  assert.equal(reviews.length, 0);
});

test("reviewArticle rejects an invalid publication status", async () => {
  const { reviewArticle } = await import("@/lib/article-library/review");

  const result = await reviewArticle({
    articleId: "a1",
    status: "ARCHIVED" as never,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
  assert.equal(result.error, "Invalid status");
  assert.equal(reviews.length, 0);
});
