process.env.LOG_LEVEL = "error";

/**
 * Unit tests for src/lib/reader/route-guard.ts (REF-003).
 *
 * Verifies the two shared invariants:
 *   1. requireReadableArticle — uniform 404 when article is not readable,
 *      returns {article, context} on success, never touches rate-limit.
 *   2. requireReadableArticleForAI — same access gate, THEN consumes the
 *      user-keyed "ai" rate-limit. Rate-limit is NOT consumed on denial.
 */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { buildArticle } from "./helpers";

const user = { id: "user-1", role: "Reader" };
const article = buildArticle({ id: "article-1", ownerId: "user-1" });

let viewableCalls: Array<{ id: string; userId?: string | null; role?: string | null }> = [];
let rateLimitCalls: Array<{ userId: string; scope: string }> = [];
let rateLimitShouldThrow = false;

let returnArticle: unknown = null;

before(() => {
  mock.module("@/lib/article-access", {
    namedExports: {
      articleAccessContext: (u: { id?: string | null; role?: string | null }) => ({
        userId: u?.id ?? null,
        role: u?.role ?? null,
      }),
      getReadableArticleById: async (id: string, ctx: { userId?: string | null; role?: string | null }) => {
        viewableCalls.push({ id, userId: ctx?.userId, role: ctx?.role });
        return returnArticle;
      },
    },
  });

  mock.module("@/lib/rate-limit", {
    namedExports: {
      checkRateLimit: async (userId: string, scope: string) => {
        rateLimitCalls.push({ userId, scope });
        if (rateLimitShouldThrow) throw new Error("rate limit exceeded");
      },
    },
  });
});

beforeEach(() => {
  viewableCalls = [];
  rateLimitCalls = [];
  rateLimitShouldThrow = false;
  returnArticle = null;
});

test("requireReadableArticle — throws 404 when article is not readable", async () => {
  const { requireReadableArticle } = await import("@/lib/reader/route-guard");

  returnArticle = null;
  await assert.rejects(
    () => requireReadableArticle("missing-id", user),
    (err: { status: number; message: string }) => {
      assert.equal(err.status, 404);
      assert.equal(err.message, "Article not found");
      return true;
    },
  );
  assert.deepEqual(viewableCalls, [{ id: "missing-id", userId: "user-1", role: "Reader" }]);
  assert.equal(rateLimitCalls.length, 0, "rate-limit must not be touched on access denial");
});

test("requireReadableArticle — returns article and context when readable", async () => {
  const { requireReadableArticle } = await import("@/lib/reader/route-guard");

  returnArticle = article;
  const result = await requireReadableArticle("article-1", user);

  assert.deepEqual(result.article, article);
  assert.deepEqual(result.context, { userId: "user-1", role: "Reader" });
  assert.equal(rateLimitCalls.length, 0);
});

test("requireReadableArticleForAI — throws 404 and does NOT consume rate-limit when article is not readable", async () => {
  const { requireReadableArticleForAI } = await import("@/lib/reader/route-guard");

  returnArticle = null;
  await assert.rejects(
    () => requireReadableArticleForAI("foreign-private", user),
    (err: { status: number }) => {
      assert.equal(err.status, 404);
      return true;
    },
  );
  assert.deepEqual(viewableCalls, [{ id: "foreign-private", userId: "user-1", role: "Reader" }]);
  assert.equal(
    rateLimitCalls.length,
    0,
    "rate-limit quota must NOT be consumed when article access is denied (IDOR + quota safety)",
  );
});

test("requireReadableArticleForAI — returns article and context, consuming user-keyed AI rate-limit", async () => {
  const { requireReadableArticleForAI } = await import("@/lib/reader/route-guard");

  returnArticle = article;
  const result = await requireReadableArticleForAI("article-1", user);

  assert.deepEqual(result.article, article);
  assert.deepEqual(result.context, { userId: "user-1", role: "Reader" });
  assert.deepEqual(rateLimitCalls, [{ userId: "user-1", scope: "ai" }]);
});

test("requireReadableArticleForAI — propagates rate-limit error when quota is exceeded", async () => {
  const { requireReadableArticleForAI } = await import("@/lib/reader/route-guard");

  returnArticle = article;
  rateLimitShouldThrow = true;
  await assert.rejects(() => requireReadableArticleForAI("article-1", user), /rate limit exceeded/);
  // Article access was checked first (before the rate-limit throw).
  assert.deepEqual(viewableCalls, [{ id: "article-1", userId: "user-1", role: "Reader" }]);
});
