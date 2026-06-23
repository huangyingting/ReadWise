import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

process.env.LOG_LEVEL = "error";

type ArticleRow = {
  id: string;
  takedownState: string;
  status: string;
  rightsNote: string | null;
};

let articles: Map<string, ArticleRow>;
let reviews: Array<Record<string, unknown>>;

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
});

beforeEach(() => {
  articles = new Map([
    ["a1", { id: "a1", takedownState: "active", status: "PUBLISHED", rightsNote: null }],
  ]);
  reviews = [];
});

test("applyTakedown unpublishes a published article and records history", async () => {
  const { applyTakedown } = await import("@/lib/content-policy");
  const result = await applyTakedown({
    articleId: "a1",
    state: "takedown",
    reviewerId: "admin-1",
    note: "DMCA request",
    rightsNote: "removed at publisher request",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.previousState, "active");
  assert.equal(result.state, "takedown");
  assert.equal(result.status, "DRAFT");

  const row = articles.get("a1");
  assert.equal(row?.takedownState, "takedown");
  assert.equal(row?.status, "DRAFT");
  assert.equal(row?.rightsNote, "removed at publisher request");

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].action, "takedown.takedown");
  assert.equal(reviews[0].reviewerId, "admin-1");
});

test("restoring to active does NOT auto-publish", async () => {
  articles.set("a1", { id: "a1", takedownState: "takedown", status: "DRAFT", rightsNote: null });
  const { applyTakedown } = await import("@/lib/content-policy");
  const result = await applyTakedown({ articleId: "a1", state: "active" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "DRAFT");
  assert.equal(articles.get("a1")?.status, "DRAFT");
  assert.equal(articles.get("a1")?.takedownState, "active");
});

test("applyTakedown returns 404 for an unknown article", async () => {
  const { applyTakedown } = await import("@/lib/content-policy");
  const result = await applyTakedown({ articleId: "missing", state: "unpublished" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 404);
});

test("applyTakedown rejects an invalid state with 400", async () => {
  const { applyTakedown } = await import("@/lib/content-policy");
  const result = await applyTakedown({
    articleId: "a1",
    state: "bogus" as unknown as "active",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
});
