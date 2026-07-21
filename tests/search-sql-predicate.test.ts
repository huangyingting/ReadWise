/**
 * Regression tests for the raw SQL adapter of the canonical readable-article
 * policy used by PostgreSQL FTS.
 *
 * These tests lock down SQL rendering and parameter binding for the same policy
 * expression consumed by `canReadArticle` and `readableArticleWhere`.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readableArticleSqlPredicate,
  type ArticleAccessContext,
} from "@/lib/article-library/policy";

// Prisma.Sql carries the raw SQL template string (with `?` placeholders) and
// the bound values array. We inspect those to verify predicate correctness.

test("anonymous context → public-listable-only predicate (no user branch)", () => {
  const sql = readableArticleSqlPredicate(null);
  const text = sql.sql;
  assert.ok(text.includes("a.status"), "must require published status");
  assert.ok(text.includes("a.visibility"), "must require PUBLIC visibility");
  assert.ok(text.includes('::"ArticleStatus"'), "must cast the mapped status value");
  assert.ok(text.includes('::"ArticleVisibility"'), "must cast the visibility value");
  assert.ok(text.includes('"ownerId" IS NULL'), "must exclude owned articles from anonymous public branch");
  assert.deepEqual(sql.values, ["published", "PUBLIC"]);
});

test("admin/system context → TRUE (unrestricted)", () => {
  const adminCtx: ArticleAccessContext = { role: "Admin" };
  const sysCtx: ArticleAccessContext = { role: "System" };

  const adminSql = readableArticleSqlPredicate(adminCtx);
  const sysSql = readableArticleSqlPredicate(sysCtx);

  assert.equal(adminSql.sql.trim(), "TRUE", "Admin → TRUE");
  assert.equal(sysSql.sql.trim(), "TRUE", "System → TRUE");
  assert.deepEqual(adminSql.values, []);
  assert.deepEqual(sysSql.values, []);
});

test("authenticated user context → public-listable OR owned-private predicate", () => {
  const userCtx: ArticleAccessContext = { userId: "user-abc", role: "Reader" };
  const sql = readableArticleSqlPredicate(userCtx);
  const text = sql.sql;

  assert.ok(text.includes("OR"), "must have OR branch for user context");
  assert.ok(text.includes("a.status"), "OR branch must include public-listable status");
  assert.ok(text.includes("a.visibility"), "OR branch must include visibility checks");
  assert.ok(text.includes("ownerId"), "must scope the PRIVATE branch to the user's ownerId");
  assert.deepEqual(
    sql.values,
    ["published", "PUBLIC", "PRIVATE", "user-abc"],
    "policy values, including userId, must be bound parameters",
  );
});

test("user context with no userId falls back to anonymous predicate", () => {
  const noIdCtx: ArticleAccessContext = { role: "Reader" };
  const sql = readableArticleSqlPredicate(noIdCtx);
  const text = sql.sql;

  assert.ok(text.includes('"ownerId" IS NULL'), "no userId → public branch still excludes owned articles");
  assert.deepEqual(sql.values, ["published", "PUBLIC"]);
});

test("organization-only context adds the matching organization branch", () => {
  const sql = readableArticleSqlPredicate({ role: "Reader", tenantId: "org-legacy" });

  assert.ok(sql.sql.includes("OR"));
  assert.ok(sql.sql.includes('a."organizationId"'));
  assert.ok(sql.sql.includes(" IN "), "ORG branch must use the same set-membership shape as Prisma");
  assert.deepEqual(sql.values, [
    "published",
    "PUBLIC",
    "published",
    "ORG",
    "org-legacy",
  ]);
});

test("multi-org context renders organization IN branch with all memberships", async () => {
  const { readableArticleWhere } = await import("@/lib/article-library/policy");
  const context: ArticleAccessContext = {
    userId: "u-1",
    role: "Reader",
    orgIds: ["org-1", "org-2"],
  };

  const where = readableArticleWhere(context) as { OR?: Array<{ organizationId?: { in?: string[] } }> };
  const orgBranch = where.OR?.find((branch) => branch.organizationId && typeof branch.organizationId === "object");
  const sql = readableArticleSqlPredicate(context);

  assert.deepEqual(orgBranch?.organizationId?.in, ["org-1", "org-2"]);
  assert.ok(sql.sql.includes('a."organizationId" IN'));
  assert.deepEqual(sql.values, [
    "published",
    "PUBLIC",
    "PRIVATE",
    "u-1",
    "published",
    "ORG",
    "org-1",
    "org-2",
  ]);
});

test("SQL and Prisma adapters cover the same policy branches", async () => {
  const { readableArticleWhere, isArticleOperator } = await import("@/lib/article-library/policy");

  const anonWhere = readableArticleWhere(null);
  const anonSql = readableArticleSqlPredicate(null);

  assert.ok(!("OR" in anonWhere), "anon Prisma where has no OR");
  assert.ok(!anonSql.sql.includes("OR"), "anon SQL has no OR");
  assert.ok(anonSql.sql.includes('"organizationId" IS NULL'), "anon SQL excludes org-owned articles from public branch");

  const userCtx: ArticleAccessContext = { userId: "u-1", role: "Reader" };
  const userWhere = readableArticleWhere(userCtx);
  const userSql = readableArticleSqlPredicate(userCtx);

  assert.ok("OR" in userWhere, "user Prisma where has OR");
  assert.ok(userSql.sql.includes("OR"), "user SQL has OR");

  const orgCtx: ArticleAccessContext = { userId: "u-1", role: "Reader", orgId: "org-1" };
  const orgWhere = readableArticleWhere(orgCtx);
  const orgSql = readableArticleSqlPredicate(orgCtx);

  assert.ok("OR" in orgWhere, "org Prisma where has OR");
  assert.deepEqual(orgSql.values, [
    "published",
    "PUBLIC",
    "PRIVATE",
    "u-1",
    "published",
    "ORG",
    "org-1",
  ]);

  const adminCtx: ArticleAccessContext = { role: "Admin" };
  assert.ok(!isArticleOperator(null), "null is not operator");
  assert.ok(isArticleOperator(adminCtx), "Admin is operator");
  const adminSql = readableArticleSqlPredicate(adminCtx);
  assert.equal(adminSql.sql.trim(), "TRUE");
});
