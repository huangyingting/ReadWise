/**
 * Regression tests for the raw SQL readable-article predicate used in
 * PostgreSQL FTS (`buildReadableArticleSqlPredicate`, fulltext.ts).
 *
 * This function is a manual mirror of `readableArticleWhere` (article-library
 * policy) for the `$queryRaw` path. These tests lock down the three policy
 * cases so a divergence from `readableArticleWhere` fails loudly here.
 *
 * See Phase 3 migration follow-up note in fulltext.ts (issue #687).
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { buildReadableArticleSqlPredicate } from "@/lib/search/fulltext";
import type { ArticleAccessContext } from "@/lib/article-library";

// Prisma.Sql carries the raw SQL template string (with `?` placeholders) and
// the bound values array. We inspect those to verify predicate correctness.

test("anonymous context → public-listable-only predicate (no user branch)", () => {
  const sql = buildReadableArticleSqlPredicate(null);
  const text = sql.sql;
  assert.ok(text.includes("published"), "must require published status");
  assert.ok(text.includes("PUBLIC"), "must require PUBLIC visibility");
  assert.ok(!text.includes("ownerId"), "must not include ownerId branch for anonymous");
  assert.deepEqual(sql.values, [], "no bound values for anonymous");
});

test("admin/system context → TRUE (unrestricted)", () => {
  const adminCtx: ArticleAccessContext = { role: "Admin" };
  const sysCtx: ArticleAccessContext = { role: "System" };

  const adminSql = buildReadableArticleSqlPredicate(adminCtx);
  const sysSql = buildReadableArticleSqlPredicate(sysCtx);

  assert.equal(adminSql.sql.trim(), "TRUE", "Admin → TRUE");
  assert.equal(sysSql.sql.trim(), "TRUE", "System → TRUE");
  assert.deepEqual(adminSql.values, []);
  assert.deepEqual(sysSql.values, []);
});

test("authenticated user context → public-listable OR owned-private predicate", () => {
  const userCtx: ArticleAccessContext = { userId: "user-abc", role: "Reader" };
  const sql = buildReadableArticleSqlPredicate(userCtx);
  const text = sql.sql;

  assert.ok(text.includes("OR"), "must have OR branch for user context");
  assert.ok(text.includes("published"), "OR branch must include public-listable status");
  assert.ok(text.includes("PUBLIC"), "OR branch must include PUBLIC visibility");
  assert.ok(text.includes("PRIVATE"), "OR branch must include PRIVATE visibility for user's own");
  assert.ok(text.includes("ownerId"), "must scope the PRIVATE branch to the user's ownerId");
  // The userId must be a bound parameter, not inlined, to prevent SQL injection.
  assert.deepEqual(sql.values, ["user-abc"], "userId must be a bound parameter");
});

test("user context with no userId falls back to anonymous predicate", () => {
  const noIdCtx: ArticleAccessContext = { role: "Reader" };
  const sql = buildReadableArticleSqlPredicate(noIdCtx);
  const text = sql.sql;

  // No userId → treated as anonymous, same as readableArticleWhere with no userId.
  assert.ok(!text.includes("ownerId"), "no userId → no ownerId branch");
  assert.deepEqual(sql.values, []);
});

test("predicate mirrors readableArticleWhere for the three policy cases", async () => {
  // This test imports the Prisma-side readableArticleWhere and checks that the
  // SQL predicate produces structurally consistent coverage for the same cases:
  // anonymous → public-listable, user → readable (public OR own), admin → all.
  const { readableArticleWhere, isArticleOperator } = await import("@/lib/article-library");

  const anonWhere = readableArticleWhere(null);
  const anonSql = buildReadableArticleSqlPredicate(null);

  // Anonymous: Prisma where uses publicListableArticleWhere; SQL is public-only
  assert.ok(!("OR" in anonWhere), "anon Prisma where has no OR");
  assert.ok(!anonSql.sql.includes("OR"), "anon SQL has no OR");

  const userCtx: ArticleAccessContext = { userId: "u-1", role: "Reader" };
  const userWhere = readableArticleWhere(userCtx);
  const userSql = buildReadableArticleSqlPredicate(userCtx);

  // User: both should have OR (public-listable OR owned-private)
  assert.ok("OR" in userWhere, "user Prisma where has OR");
  assert.ok(userSql.sql.includes("OR"), "user SQL has OR");

  const adminCtx: ArticleAccessContext = { role: "Admin" };
  // Admin: Prisma where is empty (no filter), SQL is TRUE
  assert.ok(!isArticleOperator(null), "null is not operator");
  assert.ok(isArticleOperator(adminCtx), "Admin is operator");
  const adminSql = buildReadableArticleSqlPredicate(adminCtx);
  assert.equal(adminSql.sql.trim(), "TRUE");
});
