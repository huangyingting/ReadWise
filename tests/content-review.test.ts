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
  visibility: string;
  ownerId: string | null;
  organizationId: string | null;
};

let articles: Map<string, ArticleRow>;
let reviews: Array<Record<string, unknown>>;
let tagsByArticle: Map<string, { id: string; name: string; slug: string }[]>;
let setTagsCalls: Array<{ articleId: string; names: string[] }>;
let beforeArticleUpdateMany: (() => void) | null;

function selectedArticle(
  row: ArticleRow,
  select?: Record<string, boolean>,
): ArticleRow | Record<string, unknown> {
  if (!select) return row;
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, value]) => value)
      .map(([key]) => [key, (row as unknown as Record<string, unknown>)[key]]),
  );
}

function matchesArticleWhere(
  row: ArticleRow,
  where: Record<string, unknown>,
): boolean {
  if (typeof where.id === "string" && row.id !== where.id) return false;
  if ("ownerId" in where && row.ownerId !== where.ownerId) return false;
  if (
    "organizationId" in where &&
    row.organizationId !== where.organizationId
  ) {
    return false;
  }
  if (typeof where.visibility === "string") {
    return row.visibility === where.visibility;
  }
  const visibility = where.visibility as { in?: string[] } | undefined;
  return !visibility?.in || visibility.in.includes(row.visibility);
}

before(() => {
  const article = {
    findUnique: async (a: { where: { id: string }; select?: Record<string, boolean> }) => {
      const row = articles.get(a.where.id) ?? null;
      return row ? selectedArticle(row, a.select) : null;
    },
    findFirst: async (a: {
      where: Record<string, unknown>;
      select?: Record<string, boolean>;
    }) => {
      const row = [...articles.values()].find((candidate) =>
        matchesArticleWhere(candidate, a.where),
      );
      return row ? selectedArticle(row, a.select) : null;
    },
    update: async (a: { where: { id: string }; data: Partial<ArticleRow> }) => {
      const row = articles.get(a.where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, a.data);
      return row;
    },
    updateMany: async (a: {
      where: { id: string; takedownState?: string };
      data: Partial<ArticleRow>;
    }) => {
      beforeArticleUpdateMany?.();
      const row = articles.get(a.where.id);
      if (
        !row ||
        (a.where.takedownState !== undefined &&
          row.takedownState !== a.where.takedownState)
      ) {
        return { count: 0 };
      }
      Object.assign(row, a.data);
      return { count: 1 };
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
  mock.module("@/lib/article-library/collections", {
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
        visibility: "PUBLIC",
        ownerId: null,
        organizationId: null,
      },
    ],
  ]);
  reviews = [];
  tagsByArticle = new Map();
  setTagsCalls = [];
  beforeArticleUpdateMany = null;
});

test("reviewArticle applies corrections, records a diff, and writes history", async () => {
  const { reviewArticle } = await import("@/lib/article-library/review");
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
  const { reviewArticle } = await import("@/lib/article-library/review");
  const result = await reviewArticle({ articleId: "a1", status: "PUBLISHED" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 409);
  assert.equal(articles.get("a1")?.status, "DRAFT");
  assert.equal(reviews.length, 0);
});

test("reviewArticle publishing sets publishedAt when first published", async () => {
  const { reviewArticle } = await import("@/lib/article-library/review");
  const result = await reviewArticle({ articleId: "a1", status: "PUBLISHED" });
  assert.equal(result.ok, true);
  const row = articles.get("a1");
  assert.equal(row?.status, "PUBLISHED");
  assert.ok(row?.publishedAt instanceof Date);
});

test("reviewArticle cannot publish across a concurrent takedown", async () => {
  beforeArticleUpdateMany = () => {
    const row = articles.get("a1");
    if (row) row.takedownState = "takedown";
  };
  const { reviewArticle } = await import("@/lib/article-library/review");

  const result = await reviewArticle({ articleId: "a1", status: "PUBLISHED" });

  assert.deepEqual(result, {
    ok: false,
    error: "Cannot publish an article that is under takedown/unpublish",
    status: 409,
  });
  assert.equal(articles.get("a1")?.status, "DRAFT");
  assert.equal(reviews.length, 0);
});

test("reviewArticle applies a PUBLIC→UNLISTED visibility change and records the diff", async () => {
  const { reviewArticle } = await import("@/lib/article-library/review");
  const result = await reviewArticle({ articleId: "a1", visibility: "UNLISTED" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(articles.get("a1")?.visibility, "UNLISTED");
  assert.deepEqual(result.changes.visibility, { from: "PUBLIC", to: "UNLISTED" });
  assert.equal(reviews.length, 1);
});

test("reviewArticle no-ops an unchanged visibility but still records history", async () => {
  const { reviewArticle } = await import("@/lib/article-library/review");
  const result = await reviewArticle({ articleId: "a1", visibility: "PUBLIC" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(!("visibility" in result.changes));
  assert.equal(reviews.length, 1);
});

test("reviewArticle refuses to change visibility of a PRIVATE (owned) article (409)", async () => {
  articles.get("a1")!.visibility = "PRIVATE";
  const { reviewArticle } = await import("@/lib/article-library/review");
  const result = await reviewArticle({ articleId: "a1", visibility: "UNLISTED" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 409);
  assert.equal(result.error, "Cannot change visibility of owned or organization article");
  assert.equal(articles.get("a1")?.visibility, "PRIVATE");
  assert.equal(reviews.length, 0);
});

test("reviewArticle refuses to change visibility of an ORG article (409)", async () => {
  articles.get("a1")!.visibility = "ORG";
  const { reviewArticle } = await import("@/lib/article-library/review");
  const result = await reviewArticle({ articleId: "a1", visibility: "PUBLIC" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 409);
  assert.equal(articles.get("a1")?.visibility, "ORG");
  assert.equal(reviews.length, 0);
});

test("reviewArticle rejects an invalid category (400)", async () => {
  const { reviewArticle } = await import("@/lib/article-library/review");
  const result = await reviewArticle({ articleId: "a1", category: "not-a-category" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
});

test("reviewArticle returns 404 for unknown article", async () => {
  const { reviewArticle } = await import("@/lib/article-library/review");
  const result = await reviewArticle({ articleId: "missing", reviewState: "approved" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 404);
});

test("reviewArticle hides a foreign private article from a scoped moderator", async () => {
  articles.get("a1")!.visibility = "PRIVATE";
  articles.get("a1")!.ownerId = "owner-1";
  const { reviewArticle } = await import("@/lib/article-library/review");
  const result = await reviewArticle({
    articleId: "a1",
    reviewState: "approved",
    accessContext: {
      userId: "moderator-1",
      role: "Moderator",
      orgIds: [],
    },
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Article not found",
    status: 404,
  });
  assert.equal(reviews.length, 0);
});

test("reviewArticle hides a foreign organization article from a scoped moderator", async () => {
  articles.get("a1")!.visibility = "ORG";
  articles.get("a1")!.organizationId = "org-1";
  const { reviewArticle } = await import("@/lib/article-library/review");
  const result = await reviewArticle({
    articleId: "a1",
    reviewState: "approved",
    accessContext: {
      userId: "moderator-1",
      role: "Moderator",
      orgIds: ["other-org"],
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
  assert.equal(reviews.length, 0);
});

test("scoped moderators can review and publish unlisted public-library drafts", async () => {
  articles.get("a1")!.visibility = "UNLISTED";
  const { reviewArticle } = await import("@/lib/article-library/review");
  const result = await reviewArticle({
    articleId: "a1",
    reviewState: "approved",
    status: "PUBLISHED",
    visibility: "PUBLIC",
    accessContext: {
      userId: "moderator-1",
      role: "Moderator",
      orgIds: [],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(articles.get("a1")?.status, "PUBLISHED");
  assert.equal(articles.get("a1")?.visibility, "PUBLIC");
  assert.equal(reviews.length, 1);
});

test("reviewArticle replaces tags and records the change", async () => {
  tagsByArticle.set("a1", [{ id: "t-old", name: "Old", slug: "old" }]);
  const { reviewArticle } = await import("@/lib/article-library/review");
  const result = await reviewArticle({ articleId: "a1", tags: ["Science", "Climate"] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(setTagsCalls.length, 1);
  assert.deepEqual(setTagsCalls[0].names, ["Science", "Climate"]);
  assert.ok("tags" in result.changes);
});

test("a no-op review still records a history row", async () => {
  const { reviewArticle } = await import("@/lib/article-library/review");
  const result = await reviewArticle({ articleId: "a1", reviewerId: "admin-1", note: "checked" });
  assert.equal(result.ok, true);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].action, "review.update");
});

test("listContentReviews returns history newest-first", async () => {
  const { reviewArticle, listContentReviews } = await import("@/lib/article-library/review");
  await reviewArticle({ articleId: "a1", reviewState: "needs_work" });
  await reviewArticle({ articleId: "a1", reviewState: "approved" });
  const history = await listContentReviews("a1");
  assert.equal(history.length, 2);
  assert.equal(history[0].action, "review.approved");
});
