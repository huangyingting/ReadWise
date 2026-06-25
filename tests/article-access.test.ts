/**
 * Tests for centralized article access rules (Issue #266).
 * Covers anonymous, reader, owner, non-owner, and admin/system paths without a DB.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  ArticleStatus,
  ArticleVisibility,
  type Article,
  type Prisma,
} from "@prisma/client";
import { buildArticle } from "./helpers";

let articleRows: Article[] = [];

type FindArgs = {
  where?: Prisma.ArticleWhereInput;
  select?: Record<string, boolean>;
};

function matchesWhere(article: Article, where: Prisma.ArticleWhereInput = {}): boolean {
  const record = article as unknown as Record<string, unknown>;
  const clauses = where as Record<string, unknown>;
  const and = clauses.AND;
  if (Array.isArray(and) && !and.every((clause) => matchesWhere(article, clause as Prisma.ArticleWhereInput))) {
    return false;
  }
  const or = clauses.OR;
  if (Array.isArray(or) && !or.some((clause) => matchesWhere(article, clause as Prisma.ArticleWhereInput))) {
    return false;
  }
  for (const [key, expected] of Object.entries(clauses)) {
    if (key === "AND" || key === "OR") continue;
    const actual = record[key];
    if (expected && typeof expected === "object" && "in" in expected) {
      const values = (expected as { in?: unknown[] }).in ?? [];
      if (!values.includes(actual)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function project(article: Article, select?: Record<string, boolean>): unknown {
  if (!select) return article;
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, include]) => include)
      .map(([key]) => [key, (article as unknown as Record<string, unknown>)[key]]),
  );
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findFirst: async (args: FindArgs) => {
            const found = articleRows.find((article) => matchesWhere(article, args.where));
            return found ? project(found, args.select) : null;
          },
          findUnique: async (args: FindArgs & { where: { id: string } }) => {
            const found = articleRows.find((article) => article.id === args.where.id);
            return found ? project(found, args.select) : null;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  articleRows = [
    buildArticle({ id: "public", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PUBLIC, ownerId: null }),
    buildArticle({ id: "owner-public", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PUBLIC, ownerId: "user-1" }),
    buildArticle({ id: "draft-public", status: ArticleStatus.DRAFT, visibility: ArticleVisibility.PUBLIC, ownerId: null }),
    buildArticle({ id: "owner-u1", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PRIVATE, ownerId: "user-1" }),
    buildArticle({ id: "draft-u1", status: ArticleStatus.DRAFT, visibility: ArticleVisibility.PRIVATE, ownerId: "user-1" }),
    buildArticle({ id: "owner-u2", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.PRIVATE, ownerId: "user-2" }),
  ];
});

test("pure readability checks cover anonymous, owner, non-owner, and admin", async () => {
  const { canReadArticle } = await import("@/lib/article-library");
  const publicArticle = articleRows.find((article) => article.id === "public");
  const draftPublic = articleRows.find((article) => article.id === "draft-public");
  const ownerArticle = articleRows.find((article) => article.id === "owner-u1");
  assert.ok(publicArticle);
  assert.ok(draftPublic);
  assert.ok(ownerArticle);

  assert.equal(canReadArticle(publicArticle), true, "anonymous can read public published");
  assert.equal(canReadArticle(draftPublic), false, "anonymous cannot read drafts");
  assert.equal(canReadArticle(ownerArticle, { userId: "user-1", role: "Reader" }), true);
  assert.equal(canReadArticle(ownerArticle, { userId: "user-2", role: "Reader" }), false);
  assert.equal(canReadArticle(draftPublic, { role: "Admin" }), true);
});

test("private articles without an owner are not public after a deleted-user lifecycle", async () => {
  const { canReadArticle, isPublicListableArticle } = await import("@/lib/article-library");
  const stalePrivate = buildArticle({
    id: "stale-private",
    visibility: ArticleVisibility.PRIVATE,
    status: ArticleStatus.PUBLISHED,
    ownerId: null,
  });

  assert.equal(isPublicListableArticle(stalePrivate), false);
  assert.equal(canReadArticle(stalePrivate, { userId: "user-2", role: "Reader" }), false);
  assert.equal(canReadArticle(stalePrivate, { role: "Admin" }), true);
});

test("public-listable predicates require ownerless library articles", async () => {
  const {
    canReadArticle,
    getPublicListableArticleById,
    isPublicListableArticle,
    publicListableArticleWhere,
  } = await import("@/lib/article-library");
  const ownedPublic = articleRows.find((article) => article.id === "owner-public");
  assert.ok(ownedPublic);

  assert.deepEqual(publicListableArticleWhere(), {
    visibility: ArticleVisibility.PUBLIC,
    status: ArticleStatus.PUBLISHED,
    ownerId: null,
  });
  assert.equal(isPublicListableArticle(ownedPublic), false);
  assert.equal(canReadArticle(ownedPublic), false);
  assert.equal(await getPublicListableArticleById("owner-public"), null);
});

test("getPublicListableArticleById only returns published library articles", async () => {
  const { getPublicListableArticleById } = await import("@/lib/article-library");

  assert.equal((await getPublicListableArticleById("public"))?.id, "public");
  assert.equal(await getPublicListableArticleById("draft-public"), null);
  assert.equal(await getPublicListableArticleById("owner-u1"), null);
});

test("getReadableArticleById enforces anonymous, reader, owner, non-owner, and admin access", async () => {
  const { getReadableArticleById } = await import("@/lib/article-library");

  assert.equal((await getReadableArticleById("public", null))?.id, "public");
  assert.equal(await getReadableArticleById("owner-u1", null), null);
  assert.equal((await getReadableArticleById("owner-u1", { userId: "user-1", role: "Reader" }))?.id, "owner-u1");
  assert.equal(await getReadableArticleById("owner-u1", { userId: "user-2", role: "Reader" }), null);
  assert.equal((await getReadableArticleById("draft-public", { role: "Admin" }))?.id, "draft-public");
});

test("editable access allows owners and admins but blocks anonymous and non-owners", async () => {
  const { getEditableArticleById } = await import("@/lib/article-library");

  assert.equal(await getEditableArticleById("owner-u1", null), null);
  assert.equal((await getEditableArticleById("owner-u1", { userId: "user-1", role: "Reader" }))?.id, "owner-u1");
  assert.equal(await getEditableArticleById("owner-u1", { userId: "user-2", role: "Reader" }), null);
  assert.equal((await getEditableArticleById("draft-public", { role: "Admin" }))?.id, "draft-public");
});

test("admin-visible access is admin/system only", async () => {
  const { getAdminVisibleArticleById, SYSTEM_ARTICLE_CONTEXT } = await import("@/lib/article-library");

  assert.equal(await getAdminVisibleArticleById("public", { userId: "user-1", role: "Reader" }), null);
  assert.equal((await getAdminVisibleArticleById("draft-public", { role: "Admin" }))?.id, "draft-public");
  assert.equal((await getAdminVisibleArticleById("owner-u2", SYSTEM_ARTICLE_CONTEXT))?.id, "owner-u2");
});

test("AI-processable access follows readable rules for users and all-article rules for admins", async () => {
  const { getAiProcessableArticleById } = await import("@/lib/article-library");

  assert.equal((await getAiProcessableArticleById("public", null, { select: { title: true } }))?.title, "Test Article");
  assert.equal((await getAiProcessableArticleById("draft-u1", { userId: "user-1", role: "Reader" }))?.id, "draft-u1");
  assert.equal(await getAiProcessableArticleById("owner-u1", { userId: "user-2", role: "Reader" }), null);
  assert.equal((await getAiProcessableArticleById("draft-public", { role: "Admin" }))?.id, "draft-public");
});
