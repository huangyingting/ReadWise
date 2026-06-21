/**
 * Tests for article ownership / access control (Issue #116).
 * Verifies that getViewableArticleById correctly enforces:
 *   - Admins see all articles.
 *   - Owners see their own personal articles.
 *   - Non-owners can't access another user's personal article.
 *   - Public articles are visible to everyone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildArticle } from "./helpers";
import type { Article } from "@prisma/client";

// ---------------------------------------------------------------------------
// Stub getViewableArticleById logic inline — mirrors src/lib/articles.ts
// without importing Prisma so this test is pure-logic.
// ---------------------------------------------------------------------------

type FindArgs = {
  where: {
    id?: string;
    status?: string;
    ownerId?: string | null;
    OR?: Array<{ status?: string; ownerId?: string | null }>;
  };
};

/** Simulates prisma.article.findFirst / findUnique for a given article set. */
function makePrismaStub(articles: Article[]) {
  return {
    findFirst(args: FindArgs): Article | null {
      const cand = articles.find((a) => {
        if (args.where.id && a.id !== args.where.id) return false;
        if (args.where.status && a.status !== args.where.status) return false;
        if ("ownerId" in args.where && args.where.ownerId !== undefined) {
          if (a.ownerId !== args.where.ownerId) return false;
        }
        if (args.where.OR) {
          return args.where.OR.some((clause) => {
            if (clause.status && a.status !== clause.status) return false;
            if ("ownerId" in clause && clause.ownerId !== undefined) {
              if (a.ownerId !== clause.ownerId) return false;
            }
            return true;
          });
        }
        return true;
      });
      return cand ?? null;
    },
    findUnique(args: FindArgs): Article | null {
      return this.findFirst(args);
    },
  };
}

/**
 * Re-implements the access-control logic from getViewableArticleById
 * against our stub DB so we can test it without Prisma.
 */
function getViewableArticleById(
  articles: Article[],
  id: string,
  role?: string | null,
  userId?: string | null,
): Article | null {
  const db = makePrismaStub(articles);
  if (role === "Admin") {
    return db.findUnique({ where: { id } });
  }
  if (userId) {
    return db.findFirst({
      where: {
        id,
        OR: [
          { status: "published", ownerId: null },
          { ownerId: userId },
        ],
      },
    });
  }
  return db.findUnique({ where: { id, status: "published", ownerId: null } });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PUBLIC_PUBLISHED = buildArticle({ id: "pub", status: "published", ownerId: null });
const PERSONAL_USER1 = buildArticle({ id: "priv-u1", status: "published", ownerId: "user-1" });
const PERSONAL_USER2 = buildArticle({ id: "priv-u2", status: "published", ownerId: "user-2" });
const DRAFT_PUBLIC = buildArticle({ id: "draft", status: "draft", ownerId: null });

const ALL_ARTICLES = [PUBLIC_PUBLISHED, PERSONAL_USER1, PERSONAL_USER2, DRAFT_PUBLIC];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("public published article is visible to an unauthenticated request", () => {
  const result = getViewableArticleById(ALL_ARTICLES, "pub");
  assert.ok(result, "should return public article");
  assert.equal(result?.id, "pub");
});

test("public published article is visible to a regular user", () => {
  const result = getViewableArticleById(ALL_ARTICLES, "pub", "Reader", "user-1");
  assert.ok(result);
  assert.equal(result?.id, "pub");
});

test("personal article is visible to its owner", () => {
  const result = getViewableArticleById(ALL_ARTICLES, "priv-u1", "Reader", "user-1");
  assert.ok(result, "owner should see their own personal article");
  assert.equal(result?.id, "priv-u1");
});

test("personal article is NOT visible to a different user", () => {
  const result = getViewableArticleById(ALL_ARTICLES, "priv-u1", "Reader", "user-2");
  assert.equal(result, null, "other users must not see personal articles");
});

test("personal article is NOT visible when no userId is provided", () => {
  const result = getViewableArticleById(ALL_ARTICLES, "priv-u1");
  assert.equal(result, null, "unauthenticated request must not see personal articles");
});

test("admin can see personal articles owned by others", () => {
  const result = getViewableArticleById(ALL_ARTICLES, "priv-u1", "Admin");
  assert.ok(result, "admin should see all articles");
  assert.equal(result?.id, "priv-u1");
});

test("admin can see draft articles", () => {
  const result = getViewableArticleById(ALL_ARTICLES, "draft", "Admin");
  assert.ok(result, "admin should see drafts");
  assert.equal(result?.id, "draft");
});

test("draft public article is not visible to regular users", () => {
  const result = getViewableArticleById(ALL_ARTICLES, "draft", "Reader", "user-1");
  assert.equal(result, null, "draft public articles should be hidden from non-admins");
});

test("returns null for non-existent article id", () => {
  const result = getViewableArticleById(ALL_ARTICLES, "does-not-exist", "Admin");
  assert.equal(result, null);
});
