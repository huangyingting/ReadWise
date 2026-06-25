import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

process.env.LOG_LEVEL = "error";

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
let tagsByArticle: Map<string, { id: string; name: string; slug: string }[]>;
let setTagsCalls: Array<{ articleId: string; names: string[] }>;

before(() => {
  const article = {
    findUnique: async (a: { where: { id: string }; select?: Record<string, boolean> }) => {
      const row = articles.get(a.where.id) ?? null;
      if (!row || !a.select) return row;
      return Object.fromEntries(
        Object.entries(a.select)
          .filter(([, v]) => v)
          .map(([k]) => [k, (row as unknown as Record<string, unknown>)[k]]),
      );
    },
    update: async (a: { where: { id: string }; data: Partial<ArticleRow> }) => {
      const row = articles.get(a.where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, a.data);
      return row;
    },
  };
  const contentReview = {
    create: async (a: { data: Record<string, unknown> }) => {
      reviews.push(a.data);
      return { id: `rev-${reviews.length}`, ...a.data };
    },
    findMany: async (a: { where: { articleId: string } }) =>
      reviews
        .filter((r) => r.articleId === a.where.articleId)
        .map((r, i) => ({ id: `rev-${i}`, createdAt: new Date(), ...r }))
        .reverse(),
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
  mock.module("@/lib/difficulty", {
    namedExports: {
      parseLevel: (raw: string) => {
        const m = /\b([ABC][12])\b/.exec(raw.toUpperCase());
        return m ? m[1] : null;
      },
    },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      getArticleTags: async (articleId: string) => tagsByArticle.get(articleId) ?? [],
      setArticleTags: async (articleId: string, names: string[]) => {
        setTagsCalls.push({ articleId, names });
        const next = names.map((n, i) => ({ id: `t${i}`, name: n.trim(), slug: n.trim().toLowerCase() }));
        tagsByArticle.set(articleId, next);
        return next;
      },
    },
  });
});

beforeEach(() => {
  articles = new Map([
    [
      "a1",
      {
        id: "a1",
        title: "Old title",
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
  tagsByArticle = new Map();
  setTagsCalls = [];
});

test("reviewArticle applies corrections, records a diff, and writes history", async () => {
  const { reviewArticle } = await import("@/lib/article-library");
  const result = await reviewArticle({
    articleId: "a1",
    reviewerId: "admin-1",
    title: "New title",
    category: "tech",
    difficulty: "B2",
    reviewState: "approved",
    qualityFlags: ["thin_content"],
    note: "looks good after edits",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const row = articles.get("a1");
  assert.equal(row?.title, "New title");
  assert.equal(row?.category, "tech");
  assert.equal(row?.difficulty, "B2");
  assert.equal(row?.reviewState, "approved");
  assert.deepEqual(row?.qualityFlags, ["thin_content"]);

  assert.equal(result.reviewState, "approved");
  assert.ok("title" in result.changes);
  assert.ok("category" in result.changes);
  assert.ok("reviewState" in result.changes);

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].action, "review.approved");
  assert.equal(reviews[0].note, "looks good after edits");
});

test("reviewArticle refuses to publish a taken-down article (409)", async () => {
  articles.get("a1")!.takedownState = "takedown";
  const { reviewArticle } = await import("@/lib/article-library");
  const result = await reviewArticle({ articleId: "a1", status: "PUBLISHED" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 409);
  assert.equal(articles.get("a1")?.status, "DRAFT");
  assert.equal(reviews.length, 0);
});

test("reviewArticle publishing sets publishedAt when first published", async () => {
  const { reviewArticle } = await import("@/lib/article-library");
  const result = await reviewArticle({ articleId: "a1", status: "PUBLISHED" });
  assert.equal(result.ok, true);
  const row = articles.get("a1");
  assert.equal(row?.status, "PUBLISHED");
  assert.ok(row?.publishedAt instanceof Date);
});

test("reviewArticle rejects an invalid category (400)", async () => {
  const { reviewArticle } = await import("@/lib/article-library");
  const result = await reviewArticle({ articleId: "a1", category: "not-a-category" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
});

test("reviewArticle returns 404 for unknown article", async () => {
  const { reviewArticle } = await import("@/lib/article-library");
  const result = await reviewArticle({ articleId: "missing", reviewState: "approved" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 404);
});

test("reviewArticle replaces tags and records the change", async () => {
  tagsByArticle.set("a1", [{ id: "t-old", name: "Old", slug: "old" }]);
  const { reviewArticle } = await import("@/lib/article-library");
  const result = await reviewArticle({ articleId: "a1", tags: ["Science", "Climate"] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(setTagsCalls.length, 1);
  assert.deepEqual(setTagsCalls[0].names, ["Science", "Climate"]);
  assert.ok("tags" in result.changes);
});

test("a no-op review still records a history row", async () => {
  const { reviewArticle } = await import("@/lib/article-library");
  const result = await reviewArticle({ articleId: "a1", reviewerId: "admin-1", note: "checked" });
  assert.equal(result.ok, true);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].action, "review.update");
});

test("listContentReviews returns history newest-first", async () => {
  const { reviewArticle, listContentReviews } = await import("@/lib/article-library");
  await reviewArticle({ articleId: "a1", reviewState: "needs_work" });
  await reviewArticle({ articleId: "a1", reviewState: "approved" });
  const history = await listContentReviews("a1");
  assert.equal(history.length, 2);
  assert.equal(history[0].action, "review.approved");
});
