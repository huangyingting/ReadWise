/**
 * Tests for article-library admin tag mutation commands (ADR-0010 §6 / #686).
 *
 * Covers renameTag, mergeTags, and deleteTag — each of which owns an explicit
 * multi-model transaction boundary (Tag + ArticleTag + AuditLog). Tests verify
 * both the happy path (success + side effects) and the failure / rollback-
 * equivalent paths (error returns, no mutation on bad input).
 *
 * All Prisma and audit calls are mocked — no DB required.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { TagScope } from "@prisma/client";

// ---------------------------------------------------------------------------
// Mutable state for the mock Prisma client
// ---------------------------------------------------------------------------

type TagRow = {
  id: string;
  name: string;
  slug: string;
  scope: TagScope;
  namespace: string;
  ownerId: string | null;
};

let tags: TagRow[] = [];
let articleTags: { articleId: string; tagId: string }[] = [];

/** Calls recorded for assertions */
let tagUpdates: Array<{ where: { id: string }; data: { name: string; slug: string } }> = [];
let tagDeletes: Array<{ where: { id: string } }> = [];
let articleTagCreateMany: Array<{ data: Array<{ articleId: string; tagId: string }> }> = [];
let auditCalls: Array<{ action: string }> = [];

/** Controls whether $transaction callback throws (simulates DB failure). */
let txShouldFail = false;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

before(() => {
  // Build a module-level ref so the callback-form $transaction can pass it as
  // the `tx` argument (mirrors the pattern in tests/activity.test.ts).
  const mockPrisma: Record<string, unknown> = {};

  Object.assign(mockPrisma, {
    tag: {
      findFirst: async (a: {
        where: { id?: string; scope?: TagScope; slug?: string; namespace?: string; NOT?: { id: string } };
        select?: Record<string, unknown>;
      }) => {
        let result = tags.find((t) => {
          if (a.where.id && t.id !== a.where.id) return false;
          if (a.where.scope && t.scope !== a.where.scope) return false;
          if (a.where.slug && t.slug !== a.where.slug) return false;
          if (a.where.namespace && t.namespace !== a.where.namespace) return false;
          if (a.where.NOT?.id && t.id === a.where.NOT.id) return false;
          return true;
        });
        if (!result) return null;
        // Shape the response to include _count when requested.
        if (a.select && "_count" in a.select) {
          return {
            ...result,
            _count: { articles: articleTags.filter((at) => at.tagId === result!.id).length },
          };
        }
        return result;
      },
      update: async (a: { where: { id: string }; data: { name: string; slug: string } }) => {
        tagUpdates.push(a);
        const idx = tags.findIndex((t) => t.id === a.where.id);
        if (idx !== -1) {
          tags[idx] = { ...tags[idx], ...a.data };
        }
        return tags[idx];
      },
      delete: async (a: { where: { id: string } }) => {
        tagDeletes.push(a);
        const idx = tags.findIndex((t) => t.id === a.where.id);
        if (idx !== -1) {
          // Cascade: remove related articleTag rows.
          articleTags = articleTags.filter((at) => at.tagId !== a.where.id);
          const deleted = tags.splice(idx, 1)[0];
          return deleted;
        }
        return null;
      },
    },
    articleTag: {
      findMany: async (a: { where: { tagId?: string }; select?: Record<string, unknown> }) => {
        if (a.where.tagId) {
          return articleTags
            .filter((at) => at.tagId === a.where.tagId)
            .map((at) => ({ articleId: at.articleId }));
        }
        return [];
      },
      createMany: async (a: { data: Array<{ articleId: string; tagId: string }> }) => {
        articleTagCreateMany.push(a);
        for (const row of a.data) {
          articleTags.push(row);
        }
        return { count: a.data.length };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (txShouldFail) throw new Error("simulated transaction failure");
      return fn(mockPrisma);
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: { prisma: mockPrisma },
  });

  mock.module("@/lib/security/audit", {
    namedExports: {
      recordAuditFromRequest: async (input: { action: string }) => {
        auditCalls.push({ action: input.action });
      },
    },
  });
});

beforeEach(() => {
  tags = [
    {
      id: "tag-a",
      name: "Science",
      slug: "science",
      scope: TagScope.PUBLIC,
      namespace: "public",
      ownerId: null,
    },
    {
      id: "tag-b",
      name: "Biology",
      slug: "biology",
      scope: TagScope.PUBLIC,
      namespace: "public",
      ownerId: null,
    },
  ];
  articleTags = [
    { articleId: "art-1", tagId: "tag-a" },
    { articleId: "art-2", tagId: "tag-a" },
    { articleId: "art-3", tagId: "tag-b" },
  ];
  tagUpdates = [];
  tagDeletes = [];
  articleTagCreateMany = [];
  auditCalls = [];
  txShouldFail = false;
});

// ---------------------------------------------------------------------------
// renameTag
// ---------------------------------------------------------------------------

test("renameTag: returns 400 for empty name", async () => {
  const { renameTag } = await import("@/lib/article-library/admin-tags");
  const result = await renameTag("tag-a", "   ");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
  assert.equal(tagUpdates.length, 0);
});

test("renameTag: returns 404 for unknown tag id", async () => {
  const { renameTag } = await import("@/lib/article-library/admin-tags");
  const result = await renameTag("tag-z", "New Name");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
  assert.equal(tagUpdates.length, 0);
});

test("renameTag: returns 409 when new slug collides with a different tag", async () => {
  // "Biology" slug "biology" already exists as tag-b; renaming tag-a to it should 409.
  const { renameTag } = await import("@/lib/article-library/admin-tags");
  const result = await renameTag("tag-a", "Biology");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);
  assert.equal(tagUpdates.length, 0);
});

test("renameTag: happy path — updates tag name/slug atomically", async () => {
  const { renameTag } = await import("@/lib/article-library/admin-tags");
  const result = await renameTag("tag-a", "Natural Science");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.changed, true);
  assert.equal(tagUpdates.length, 1);
  assert.equal(tagUpdates[0].data.name, "Natural Science");
  assert.equal(tagUpdates[0].data.slug, "natural-science");
});

test("renameTag: case-only rename (same slug) returns changed=false", async () => {
  const { renameTag } = await import("@/lib/article-library/admin-tags");
  const result = await renameTag("tag-a", "SCIENCE");
  assert.equal(result.ok, true);
  // slug "science" is unchanged — changed should be false
  if (result.ok) assert.equal(result.changed, false);
});

test("renameTag: audit callback is invoked inside the transaction", async () => {
  const { renameTag } = await import("@/lib/article-library/admin-tags");
  await renameTag("tag-a", "Natural Science", (r) => ({
    req: {} as Request,
    session: { user: { id: "admin-1" } } as Parameters<typeof import("@/lib/security/audit").recordAuditFromRequest>[0]["session"],
    requestId: "req-1",
    action: "admin.tag.rename",
    targetType: "tag",
    targetId: "tag-a",
    metadata: { changed: (r as { changed: boolean }).changed },
  }));
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "admin.tag.rename");
});

// ---------------------------------------------------------------------------
// mergeTags
// ---------------------------------------------------------------------------

test("mergeTags: returns 400 when source === target", async () => {
  const { mergeTags } = await import("@/lib/article-library/admin-tags");
  const result = await mergeTags("tag-a", "tag-a");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
  assert.equal(articleTagCreateMany.length, 0);
});

test("mergeTags: returns 404 when source tag does not exist", async () => {
  const { mergeTags } = await import("@/lib/article-library/admin-tags");
  const result = await mergeTags("tag-z", "tag-b");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

test("mergeTags: returns 404 when target tag does not exist", async () => {
  const { mergeTags } = await import("@/lib/article-library/admin-tags");
  const result = await mergeTags("tag-a", "tag-z");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

test("mergeTags: happy path — re-links unique articles and deletes source", async () => {
  // tag-a has art-1, art-2; tag-b has art-3 — no overlap, so 2 links should move.
  const { mergeTags } = await import("@/lib/article-library/admin-tags");
  const result = await mergeTags("tag-a", "tag-b");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.moved, 2);
  // source (tag-a) should be deleted
  assert.equal(tagDeletes.length, 1);
  assert.equal(tagDeletes[0].where.id, "tag-a");
  // new links created for art-1 and art-2 on tag-b
  assert.equal(articleTagCreateMany.length, 1);
  assert.equal(articleTagCreateMany[0].data.length, 2);
});

test("mergeTags: skips articles already linked to target (no duplicate links)", async () => {
  // art-3 is on tag-b; add art-3 to tag-a too — it should be skipped during merge.
  articleTags.push({ articleId: "art-3", tagId: "tag-a" });
  const { mergeTags } = await import("@/lib/article-library/admin-tags");
  const result = await mergeTags("tag-a", "tag-b");
  assert.equal(result.ok, true);
  // art-1 and art-2 move; art-3 is skipped (already on target)
  if (result.ok) assert.equal(result.moved, 2);
});

test("mergeTags: source has no unique articles → moved=0, source still deleted", async () => {
  // art-1 and art-2 are ALSO on tag-b, so nothing moves but source is deleted.
  articleTags.push({ articleId: "art-1", tagId: "tag-b" });
  articleTags.push({ articleId: "art-2", tagId: "tag-b" });
  const { mergeTags } = await import("@/lib/article-library/admin-tags");
  const result = await mergeTags("tag-a", "tag-b");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.moved, 0);
  assert.equal(tagDeletes.length, 1);
  assert.equal(articleTagCreateMany.length, 0, "no createMany when nothing to move");
});

test("mergeTags: audit callback fires inside the transaction", async () => {
  const { mergeTags } = await import("@/lib/article-library/admin-tags");
  await mergeTags("tag-a", "tag-b", (r) => ({
    req: {} as Request,
    session: { user: { id: "admin-1" } } as Parameters<typeof import("@/lib/security/audit").recordAuditFromRequest>[0]["session"],
    requestId: "req-2",
    action: "admin.tag.merge",
    targetType: "tag",
    targetId: "tag-b",
    metadata: { moved: (r as { moved: number }).moved },
  }));
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "admin.tag.merge");
});

test("mergeTags: transaction failure propagates as a thrown error (no partial state)", async () => {
  txShouldFail = true;
  const { mergeTags } = await import("@/lib/article-library/admin-tags");
  await assert.rejects(
    () => mergeTags("tag-a", "tag-b"),
    /simulated transaction failure/,
  );
  // No links created, no source deleted — transaction rolled back.
  assert.equal(articleTagCreateMany.length, 0);
  assert.equal(tagDeletes.length, 0);
});

// ---------------------------------------------------------------------------
// deleteTag
// ---------------------------------------------------------------------------

test("deleteTag: returns 404 for unknown tag id", async () => {
  const { deleteTag } = await import("@/lib/article-library/admin-tags");
  const result = await deleteTag("tag-z");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
  assert.equal(tagDeletes.length, 0);
});

test("deleteTag: happy path — deletes the tag and returns article count", async () => {
  const { deleteTag } = await import("@/lib/article-library/admin-tags");
  const result = await deleteTag("tag-a");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.articleCount, 2); // art-1 and art-2
  assert.equal(tagDeletes.length, 1);
  assert.equal(tagDeletes[0].where.id, "tag-a");
});

test("deleteTag: audit callback fires inside the transaction", async () => {
  const { deleteTag } = await import("@/lib/article-library/admin-tags");
  await deleteTag("tag-a", (r) => ({
    req: {} as Request,
    session: { user: { id: "admin-1" } } as Parameters<typeof import("@/lib/security/audit").recordAuditFromRequest>[0]["session"],
    requestId: "req-3",
    action: "admin.tag.delete",
    targetType: "tag",
    targetId: "tag-a",
    metadata: { articleCount: (r as { articleCount: number }).articleCount },
  }));
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "admin.tag.delete");
});

test("deleteTag: transaction failure propagates (rollback semantics)", async () => {
  txShouldFail = true;
  const { deleteTag } = await import("@/lib/article-library/admin-tags");
  await assert.rejects(
    () => deleteTag("tag-a"),
    /simulated transaction failure/,
  );
  assert.equal(tagDeletes.length, 0);
});
