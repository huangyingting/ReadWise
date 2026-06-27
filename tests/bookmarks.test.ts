/**
 * Unit tests for src/lib/bookmarks.ts.
 * Prisma is mocked — no real DB is touched.
 *
 * Pattern (US-032): mock.module in before(), mutable let state reset in
 * beforeEach, await import(...) inside each test after mocks are installed.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mutable stub state (read by the mock implementations below)
// ---------------------------------------------------------------------------

// Used by readingList.findFirst: the stub decides which to return based on args.
let stubDefaultList: null | { id: string; name: string; isDefault: boolean } = null;
let stubListById: null | { id: string; name: string; isDefault: boolean } = null;

// Used by readingListItem.findUnique — controls whether item is "already in list"
let stubItemExists: null | { id: string; listId: string; articleId: string } = null;

// Used by article.findUnique — controls article existence
let stubArticle: null | { id: string } = { id: "a1" };

// Used by readingList.findMany (getBookmarkedArticleIds)
let stubUserLists: { id: string }[] = [];

// Used by readingListItem.findMany (getBookmarkedArticleIds)
let stubBookmarkedItems: { articleId: string }[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        readingList: {
          findFirst: async (args: { where: Record<string, unknown> }) => {
            // Distinguish getOrCreateDefaultList (has isDefault:true) from
            // ownership-check calls (has id + userId)
            if ("isDefault" in args.where) return stubDefaultList;
            if ("id" in args.where) return stubListById;
            return null;
          },
          findMany: async () => stubUserLists,
          upsert: async (args: { create: { name: string; isDefault: boolean }; update: object }) => {
            // If the stub has an existing list, return it (update path); otherwise create.
            if (stubDefaultList) return stubDefaultList;
            return { id: "list-new", name: args.create.name, isDefault: args.create.isDefault };
          },
          create: async (args: { data: { name: string; isDefault: boolean } }) => ({
            id: "list-new",
            name: args.data.name,
            isDefault: args.data.isDefault,
          }),
          update: async (args: { where: { id: string }; data: { name: string } }) => ({
            id: args.where.id,
            name: args.data.name,
            isDefault: false,
          }),
          delete: async () => ({}),
        },
        readingListItem: {
          findUnique: async () => stubItemExists,
          findMany: async () => stubBookmarkedItems,
          create: async (args: { data: { listId: string; articleId: string } }) => ({
            id: "item-1",
            ...args.data,
          }),
          delete: async () => ({}),
          deleteMany: async () => ({}),
          upsert: async (args: { create: { listId: string; articleId: string } }) => ({
            id: "item-1",
            ...args.create,
          }),
        },
        article: {
          findUnique: async () => stubArticle,
          findFirst: async () => stubArticle,
        },
      },
    },
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      toListingArticle: (a: { id: string }) => ({
        id: a.id,
        title: "Stub Article",
        author: null,
        source: null,
        category: null,
        difficulty: null,
        readingMinutes: null,
      }),
      // Visibility gate (Issue #235): bookmarks/lists route article loads
      // through this instead of a bare findUnique. The stub mirrors article
      // existence/visibility via stubArticle.
      getViewableArticleById: async () => stubArticle,
    },
  });
});

beforeEach(() => {
  stubDefaultList = null;
  stubListById = null;
  stubItemExists = null;
  stubArticle = { id: "a1" };
  stubUserLists = [];
  stubBookmarkedItems = [];
});

// ---------------------------------------------------------------------------
// getOrCreateDefaultList — lazy creation
// ---------------------------------------------------------------------------

test("getOrCreateDefaultList creates a new list when none exists", async () => {
  stubDefaultList = null; // no default list yet
  const { getOrCreateDefaultList } = await import("@/lib/article-library/collections/default-list-policy");
  const result = await getOrCreateDefaultList("user-1");
  assert.equal(result.name, "Saved");
  assert.equal(result.isDefault, true);
});

test("getOrCreateDefaultList returns existing list without creating", async () => {
  stubDefaultList = { id: "list-existing", name: "Saved", isDefault: true };
  const { getOrCreateDefaultList } = await import("@/lib/article-library/collections/default-list-policy");
  const result = await getOrCreateDefaultList("user-1");
  assert.equal(result.id, "list-existing");
});

// ---------------------------------------------------------------------------
// toggleBookmark
// ---------------------------------------------------------------------------

test("toggleBookmark adds article to default list and returns bookmarked:true", async () => {
  stubArticle = { id: "a1" };
  stubDefaultList = { id: "list-1", name: "Saved", isDefault: true };
  stubItemExists = null; // not yet in list

  const { toggleBookmark } = await import("@/lib/article-library/collections/commands");
  const result = await toggleBookmark("user-1", "a1");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.bookmarked, true);
});

test("toggleBookmark removes article from default list and returns bookmarked:false", async () => {
  stubArticle = { id: "a1" };
  stubDefaultList = { id: "list-1", name: "Saved", isDefault: true };
  stubItemExists = { id: "item-1", listId: "list-1", articleId: "a1" };

  const { toggleBookmark } = await import("@/lib/article-library/collections/commands");
  const result = await toggleBookmark("user-1", "a1");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.bookmarked, false);
});

test("toggleBookmark returns 404 when article does not exist", async () => {
  stubArticle = null;

  const { toggleBookmark } = await import("@/lib/article-library/collections/commands");
  const result = await toggleBookmark("user-1", "missing");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

// ---------------------------------------------------------------------------
// addToList
// ---------------------------------------------------------------------------

test("addToList succeeds for an owned list with a valid article", async () => {
  stubListById = { id: "list-1", name: "My List", isDefault: false };
  stubArticle = { id: "a1" };

  const { addToList } = await import("@/lib/article-library/collections/commands");
  const result = await addToList("list-1", "user-1", "a1");
  assert.equal(result.ok, true);
});

test("addToList returns 404 when list belongs to another user", async () => {
  stubListById = null; // ownership check fails — list not found for this user

  const { addToList } = await import("@/lib/article-library/collections/commands");
  const result = await addToList("other-list", "user-1", "a1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

test("addToList returns 404 when article does not exist", async () => {
  stubListById = { id: "list-1", name: "My List", isDefault: false };
  stubArticle = null;

  const { addToList } = await import("@/lib/article-library/collections/commands");
  const result = await addToList("list-1", "user-1", "missing");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

// ---------------------------------------------------------------------------
// removeFromList
// ---------------------------------------------------------------------------

test("removeFromList succeeds for an owned list", async () => {
  stubListById = { id: "list-1", name: "My List", isDefault: false };

  const { removeFromList } = await import("@/lib/article-library/collections/commands");
  const result = await removeFromList("list-1", "user-1", "a1");
  assert.equal(result.ok, true);
});

test("removeFromList returns 404 when list belongs to another user", async () => {
  stubListById = null;

  const { removeFromList } = await import("@/lib/article-library/collections/commands");
  const result = await removeFromList("other-list", "user-1", "a1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

// ---------------------------------------------------------------------------
// deleteList
// ---------------------------------------------------------------------------

test("deleteList refuses to delete the default list and returns 409", async () => {
  stubListById = { id: "list-1", name: "Saved", isDefault: true };

  const { deleteList } = await import("@/lib/article-library/collections/commands");
  const result = await deleteList("list-1", "user-1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);
});

test("deleteList returns 404 for a missing list", async () => {
  stubListById = null;

  const { deleteList } = await import("@/lib/article-library/collections/commands");
  const result = await deleteList("list-99", "user-1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

test("deleteList succeeds for a non-default owned list", async () => {
  stubListById = { id: "list-2", name: "Favorites", isDefault: false };

  const { deleteList } = await import("@/lib/article-library/collections/commands");
  const result = await deleteList("list-2", "user-1");
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// getBookmarkedArticleIds
// ---------------------------------------------------------------------------

test("getBookmarkedArticleIds returns empty set when articleIds is empty", async () => {
  const { getBookmarkedArticleIds } = await import("@/lib/article-library/collections/read-models");
  const result = await getBookmarkedArticleIds("user-1", []);
  assert.equal(result.size, 0);
});

test("getBookmarkedArticleIds returns empty set when user has no lists", async () => {
  stubUserLists = [];

  const { getBookmarkedArticleIds } = await import("@/lib/article-library/collections/read-models");
  const result = await getBookmarkedArticleIds("user-1", ["a1", "a2"]);
  assert.equal(result.size, 0);
});

test("getBookmarkedArticleIds returns only the bookmarked article ids", async () => {
  stubUserLists = [{ id: "list-1" }];
  stubBookmarkedItems = [{ articleId: "a1" }]; // a1 is bookmarked, a2 is not

  const { getBookmarkedArticleIds } = await import("@/lib/article-library/collections/read-models");
  const result = await getBookmarkedArticleIds("user-1", ["a1", "a2"]);
  assert.equal(result.size, 1);
  assert.ok(result.has("a1"));
  assert.ok(!result.has("a2"));
});

// ---------------------------------------------------------------------------
// Visibility gating (Issue #235): non-viewable articles (drafts / other users'
// private imports) must be rejected as 404 by add/toggle/membership so they
// can't be attached to a list or leaked via an existence oracle.
// getViewableArticleById returns null for a non-viewable article.
// ---------------------------------------------------------------------------

test("addToList returns 404 when the article is not viewable", async () => {
  stubListById = { id: "list-1", name: "My List", isDefault: false };
  stubArticle = null; // getViewableArticleById sees draft/foreign import

  const { addToList } = await import("@/lib/article-library/collections/commands");
  const result = await addToList("list-1", "user-1", "draft-1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

test("toggleBookmark returns 404 when the article is not viewable", async () => {
  stubArticle = null; // getViewableArticleById sees draft/foreign import

  const { toggleBookmark } = await import("@/lib/article-library/collections/commands");
  const result = await toggleBookmark("user-1", "foreign-import");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
});

test("getArticleListMembership returns null when the article is not viewable", async () => {
  stubArticle = null; // getViewableArticleById sees draft/foreign import

  const { getArticleListMembership } = await import("@/lib/article-library/collections/membership");
  const result = await getArticleListMembership("user-1", "draft-1");
  assert.equal(result, null);
});
