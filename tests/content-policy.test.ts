import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

process.env.LOG_LEVEL = "error";

type ArticleRow = {
  id: string;
  takedownState: string;
  status: string;
  rightsNote: string | null;
  visibility: string;
  ownerId: string | null;
  organizationId: string | null;
};

let articles: Map<string, ArticleRow>;
let reviews: Array<Record<string, unknown>>;

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

function articleRow(overrides: Partial<ArticleRow> = {}): ArticleRow {
  return {
    id: "a1",
    takedownState: "active",
    status: "PUBLISHED",
    rightsNote: null,
    visibility: "PUBLIC",
    ownerId: null,
    organizationId: null,
    ...overrides,
  };
}

function setArticle(overrides: Partial<ArticleRow>): void {
  articles.set("a1", articleRow(overrides));
}

function assertStoredArticle(
  expected: Partial<Pick<ArticleRow, "status" | "takedownState" | "rightsNote">>,
): void {
  const row = articles.get("a1");
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(row?.[field as keyof ArticleRow], value);
  }
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
  articles = new Map([["a1", articleRow()]]);
  reviews = [];
});

test("applyTakedown unpublishes a published article and records history", async () => {
  const { applyTakedown } = await import("@/lib/article-library");
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

  assertStoredArticle({
    takedownState: "takedown",
    status: "DRAFT",
    rightsNote: "removed at publisher request",
  });

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].action, "takedown.takedown");
  assert.equal(reviews[0].reviewerId, "admin-1");
});

test("restoring to active does NOT auto-publish", async () => {
  setArticle({ takedownState: "takedown", status: "DRAFT" });
  const { applyTakedown } = await import("@/lib/article-library");
  const result = await applyTakedown({ articleId: "a1", state: "active" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "DRAFT");
  assertStoredArticle({ status: "DRAFT", takedownState: "active" });
});

test("applyTakedown returns 404 for an unknown article", async () => {
  const { applyTakedown } = await import("@/lib/article-library");
  const result = await applyTakedown({ articleId: "missing", state: "unpublished" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 404);
});

test("applyTakedown hides foreign private and organization articles from scoped moderators", async () => {
  const { applyTakedown } = await import("@/lib/article-library");
  for (const article of [
    { visibility: "PRIVATE", ownerId: "owner-1", organizationId: null },
    { visibility: "ORG", ownerId: null, organizationId: "org-1" },
  ]) {
    setArticle(article);
    const result = await applyTakedown({
      articleId: "a1",
      state: "takedown",
      accessContext: {
        userId: "moderator-1",
        role: "Moderator",
        orgIds: ["other-org"],
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  }
  assert.equal(reviews.length, 0);
});

test("scoped moderators can restore their public-library takedowns", async () => {
  const { applyTakedown } = await import("@/lib/article-library");
  const accessContext = {
    userId: "moderator-1",
    role: "Moderator",
    orgIds: [] as string[],
  };

  const takedown = await applyTakedown({
    articleId: "a1",
    state: "takedown",
    accessContext,
  });
  assert.equal(takedown.ok, true);
  assertStoredArticle({ status: "DRAFT", takedownState: "takedown" });

  const restore = await applyTakedown({
    articleId: "a1",
    state: "active",
    accessContext,
  });
  assert.equal(restore.ok, true);
  assertStoredArticle({ status: "DRAFT", takedownState: "active" });
});

test("applyTakedown rejects an invalid state with 400", async () => {
  const { applyTakedown } = await import("@/lib/article-library");
  const result = await applyTakedown({
    articleId: "a1",
    state: "bogus" as unknown as "active",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
});

test("applyTakedown on a FAILED article preserves FAILED status", async () => {
  setArticle({ status: "FAILED" });
  const { applyTakedown } = await import("@/lib/article-library");
  const result = await applyTakedown({ articleId: "a1", state: "takedown" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // FAILED is already non-public — status must NOT be forced to DRAFT
  assert.equal(result.status, "FAILED");
  assertStoredArticle({ status: "FAILED", takedownState: "takedown" });
});

test("applyTakedown on an ARCHIVED article preserves ARCHIVED status", async () => {
  setArticle({ status: "ARCHIVED" });
  const { applyTakedown } = await import("@/lib/article-library");
  const result = await applyTakedown({ articleId: "a1", state: "unpublished" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "ARCHIVED");
  assertStoredArticle({ status: "ARCHIVED" });
});

test("applyTakedown on a DRAFT article preserves DRAFT status", async () => {
  setArticle({ status: "DRAFT" });
  const { applyTakedown } = await import("@/lib/article-library");
  const result = await applyTakedown({ articleId: "a1", state: "archived" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "DRAFT");
  assertStoredArticle({ status: "DRAFT" });
});

test("restoring a FAILED article to active leaves status as FAILED", async () => {
  setArticle({ takedownState: "takedown", status: "FAILED" });
  const { applyTakedown } = await import("@/lib/article-library");
  const result = await applyTakedown({ articleId: "a1", state: "active" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "FAILED");
  assertStoredArticle({ takedownState: "active" });
});
