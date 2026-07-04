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
let orgRows: Array<{ id: string }> = [];

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
    if (expected && typeof expected === "object" && "not" in expected) {
      if (actual === (expected as { not?: unknown }).not) return false;
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

async function articleLibrary() {
  return import("@/lib/article-library");
}

function articleById(id: string): Article {
  const article = articleRows.find((row) => row.id === id);
  assert.ok(article, `expected fixture article ${id}`);
  return article;
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findMany: async (args: FindArgs) =>
            articleRows
              .filter((article) => matchesWhere(article, args.where))
              .map((article) => project(article, args.select) as Article),
          findFirst: async (args: FindArgs) => {
            const found = articleRows.find((article) => matchesWhere(article, args.where));
            return found ? project(found, args.select) : null;
          },
          findUnique: async (args: FindArgs & { where: { id: string } }) => {
            const found = articleRows.find((article) => article.id === args.where.id);
            return found ? project(found, args.select) : null;
          },
        },
        organization: {
          findUnique: async (args: { where: { id: string } }) =>
            orgRows.find((org) => org.id === args.where.id) ?? null,
          findMany: async (args: { where: { id: { in: string[] } } }) =>
            orgRows.filter((org) => args.where.id.in.includes(org.id)),
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
    buildArticle({ id: "org-1-article", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.ORG, organizationId: "org-1" }),
    buildArticle({ id: "org-2-article", status: ArticleStatus.PUBLISHED, visibility: ArticleVisibility.ORG, organizationId: "org-2" }),
  ];
  orgRows = [{ id: "org-1" }, { id: "org-2" }];
});

test("pure readability checks cover anonymous, owner, non-owner, and admin", async () => {
  const { canReadArticle } = await articleLibrary();
  const publicArticle = articleById("public");
  const draftPublic = articleById("draft-public");
  const ownerArticle = articleById("owner-u1");

  assert.equal(canReadArticle(publicArticle), true, "anonymous can read public published");
  assert.equal(canReadArticle(draftPublic), false, "anonymous cannot read drafts");
  assert.equal(canReadArticle(ownerArticle, { userId: "user-1", role: "Reader" }), true);
  assert.equal(canReadArticle(ownerArticle, { userId: "user-2", role: "Reader" }), false);
  assert.equal(canReadArticle(draftPublic, { role: "Admin" }), true);
});

test("private articles without an owner are not public after a deleted-user lifecycle", async () => {
  const { canReadArticle, isPublicListableArticle } = await articleLibrary();
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
  } = await articleLibrary();
  const ownedPublic = articleById("owner-public");

  assert.deepEqual(publicListableArticleWhere(), {
    visibility: ArticleVisibility.PUBLIC,
    status: ArticleStatus.PUBLISHED,
    ownerId: null,
    organizationId: null,
  });
  assert.equal(isPublicListableArticle(ownedPublic), false);
  assert.equal(canReadArticle(ownedPublic), false);
  assert.equal(await getPublicListableArticleById("owner-public"), null);
});

test("getPublicListableArticleById only returns published library articles", async () => {
  const { getPublicListableArticleById } = await articleLibrary();

  assert.equal((await getPublicListableArticleById("public"))?.id, "public");
  assert.equal(await getPublicListableArticleById("draft-public"), null);
  assert.equal(await getPublicListableArticleById("owner-u1"), null);
});

test("getReadableArticleById enforces anonymous, reader, owner, non-owner, and admin access", async () => {
  const { getReadableArticleById } = await articleLibrary();

  assert.equal((await getReadableArticleById("public", null))?.id, "public");
  assert.equal(await getReadableArticleById("owner-u1", null), null);
  assert.equal((await getReadableArticleById("owner-u1", { userId: "user-1", role: "Reader" }))?.id, "owner-u1");
  assert.equal(await getReadableArticleById("owner-u1", { userId: "user-2", role: "Reader" }), null);
  assert.equal((await getReadableArticleById("draft-public", { role: "Admin" }))?.id, "draft-public");
});

test("org-scoped articles are readable only in the matching tenant context", async () => {
  const {
    canReadArticle,
    getOrganizationAssignableArticle,
    getReadableArticleById,
    isOrganizationScopedArticle,
    readableArticleWhere,
    orgScopedArticleWhere,
  } = await articleLibrary();
  const orgArticle = articleById("org-1-article");
  const publicWithOrg = buildArticle({
    id: "public-with-org",
    visibility: ArticleVisibility.PUBLIC,
    status: ArticleStatus.PUBLISHED,
    ownerId: null,
    organizationId: "org-1",
  });

  assert.equal(isOrganizationScopedArticle(articleById("public")), false);
  assert.equal(isOrganizationScopedArticle(orgArticle), true);
  assert.equal(canReadArticle(orgArticle, { userId: "user-1", role: "Reader", orgId: "org-1" }), true);
  assert.equal(canReadArticle(orgArticle, { userId: "user-1", role: "Reader", orgId: "org-2" }), false);
  assert.equal(canReadArticle(publicWithOrg), false);
  assert.deepEqual(orgScopedArticleWhere("org-1"), {
    visibility: ArticleVisibility.ORG,
    status: ArticleStatus.PUBLISHED,
    organizationId: "org-1",
  });
  assert.equal((await getReadableArticleById("org-1-article", { userId: "user-1", role: "Reader", orgId: "org-1" }))?.id, "org-1-article");
  assert.equal(await getReadableArticleById("org-1-article", { userId: "user-1", role: "Reader", orgId: "org-2" }), null);
  assert.deepEqual(await getOrganizationAssignableArticle("org-2-article", "org-1"), {
    ok: false,
    status: 404,
    reason: "org_reference_mismatch",
  });
  assert.ok("OR" in readableArticleWhere({ userId: "user-1", role: "Reader", orgId: "org-1" }));
});

test("article organization integrity validates create, update, read, and delete scopes", async () => {
  const {
    articleOrganizationIntegrityIssues,
    validateArticleOrganizationIntegrity,
    findArticleOrganizationIntegrityIssues,
  } = await articleLibrary();
  const valid = buildArticle({
    id: "valid-org",
    visibility: ArticleVisibility.ORG,
    organizationId: "org-1",
  });
  const missingOrgId = buildArticle({
    id: "missing-org-id",
    visibility: ArticleVisibility.ORG,
    organizationId: null,
  });
  const mismatched = buildArticle({
    id: "mismatched-org",
    visibility: ArticleVisibility.ORG,
    organizationId: "org-2",
  });
  const publicWithOrg = buildArticle({
    id: "public-with-org",
    visibility: ArticleVisibility.PUBLIC,
    organizationId: "org-1",
  });

  assert.deepEqual(articleOrganizationIntegrityIssues(valid, "create", "org-1"), []);
  assert.equal(articleOrganizationIntegrityIssues(missingOrgId, "update")[0].reason, "org_visibility_without_org");
  assert.equal(articleOrganizationIntegrityIssues(publicWithOrg, "delete")[0].reason, "org_reference_without_org_visibility");
  assert.equal(articleOrganizationIntegrityIssues(mismatched, "read", "org-1")[0].reason, "org_reference_mismatch");
  assert.deepEqual(await validateArticleOrganizationIntegrity(valid, "read", { expectedOrgId: "org-1" }), []);

  articleRows.push(
    buildArticle({ id: "orphan", visibility: ArticleVisibility.ORG, organizationId: "missing-org" }),
  );
  const findings = await findArticleOrganizationIntegrityIssues();
  assert.ok(findings.some((finding) => finding.articleId === "orphan" && finding.reason === "org_reference_orphaned"));
});

test("editable access allows owners and admins but blocks anonymous and non-owners", async () => {
  const { getEditableArticleById } = await articleLibrary();

  assert.equal(await getEditableArticleById("owner-u1", null), null);
  assert.equal((await getEditableArticleById("owner-u1", { userId: "user-1", role: "Reader" }))?.id, "owner-u1");
  assert.equal(await getEditableArticleById("owner-u1", { userId: "user-2", role: "Reader" }), null);
  assert.equal((await getEditableArticleById("draft-public", { role: "Admin" }))?.id, "draft-public");
});

test("admin-visible access is admin/system only", async () => {
  const { getAdminVisibleArticleById, SYSTEM_ARTICLE_CONTEXT } = await articleLibrary();

  assert.equal(await getAdminVisibleArticleById("public", { userId: "user-1", role: "Reader" }), null);
  assert.equal((await getAdminVisibleArticleById("draft-public", { role: "Admin" }))?.id, "draft-public");
  assert.equal((await getAdminVisibleArticleById("owner-u2", SYSTEM_ARTICLE_CONTEXT))?.id, "owner-u2");
});

test("AI-processable access follows readable rules for users and all-article rules for admins", async () => {
  const { getAiProcessableArticleById } = await articleLibrary();

  assert.equal((await getAiProcessableArticleById("public", null, { select: { title: true } }))?.title, "Test Article");
  assert.equal((await getAiProcessableArticleById("draft-u1", { userId: "user-1", role: "Reader" }))?.id, "draft-u1");
  assert.equal(await getAiProcessableArticleById("owner-u1", { userId: "user-2", role: "Reader" }), null);
  assert.equal((await getAiProcessableArticleById("draft-public", { role: "Admin" }))?.id, "draft-public");
});
