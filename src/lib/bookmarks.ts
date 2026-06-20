/**
 * Reading lists and bookmarks helpers (M10).
 *
 * Every list operation is ownership-checked: callers supply both the list id
 * and the user id, and a missing-or-wrong-owner list always surfaces as a 404
 * so IDOR is impossible.
 *
 * Key design decisions
 * - One **default list** ("Saved") per user, lazily created on first use.
 * - Quick-bookmark (toggleBookmark) always targets the default list.
 * - Helpers return structured `{ok, …} | {ok:false, error, status}` results
 *   instead of throwing so API routes can map to the correct HTTP status
 *   without catch-and-rethrow.
 * - add/remove are idempotent: adding an already-present article is silently
 *   treated as a no-op; removing a missing item also succeeds.
 */

import { prisma } from "@/lib/prisma";
import { toListingArticle, type ListingArticle } from "@/lib/articles";

const DEFAULT_LIST_NAME = "Saved";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type UserList = {
  id: string;
  name: string;
  isDefault: boolean;
  count: number;
};

export type ListWithArticles = {
  id: string;
  name: string;
  isDefault: boolean;
  articles: ListingArticle[];
};

type ErrResult = { ok: false; error: string; status: number };
/** A successful result with no additional payload. */
type SimpleResult = { ok: true } | ErrResult;
/** A successful result carrying extra data fields. */
type DataResult<T extends object> = ({ ok: true } & T) | ErrResult;

// ---------------------------------------------------------------------------
// Default list
// ---------------------------------------------------------------------------

/**
 * Returns the user's default "Saved" list, creating it lazily if it does not
 * yet exist. Uses upsert on the (userId, name) unique key so concurrent first
 * calls collapse into one row — no duplicate default lists.
 */
export async function getOrCreateDefaultList(
  userId: string,
): Promise<{ id: string; name: string; isDefault: boolean }> {
  return prisma.readingList.upsert({
    where: { userId_name: { userId, name: DEFAULT_LIST_NAME } },
    create: { userId, name: DEFAULT_LIST_NAME, isDefault: true },
    update: {},
  });
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * Returns all lists for a user, default list first (isDefault desc), then
 * oldest-first. Each list includes the number of items it contains.
 */
export async function getUserLists(userId: string): Promise<UserList[]> {
  const rows = await prisma.readingList.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { _count: { select: { items: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    count: row._count.items,
  }));
}

/**
 * Returns a list and its articles, ownership-checked. Returns `null` when the
 * list does not exist or belongs to a different user (caller maps to 404).
 * Articles are ordered newest-added-first.
 */
export async function getListWithArticles(
  listId: string,
  userId: string,
): Promise<ListWithArticles | null> {
  const row = await prisma.readingList.findFirst({
    where: { id: listId, userId },
    include: {
      items: {
        orderBy: { addedAt: "desc" },
        include: { article: true },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    articles: row.items.map((item) => toListingArticle(item.article)),
  };
}

// ---------------------------------------------------------------------------
// CRUD on lists
// ---------------------------------------------------------------------------

/** Creates a new (non-default) named list for the user. */
export async function createList(
  userId: string,
  name: string,
): Promise<{ id: string; name: string; isDefault: boolean }> {
  return prisma.readingList.create({
    data: { userId, name, isDefault: false },
  });
}

/** Renames a list. Ownership-checked; 404 if missing or not owned. */
export async function renameList(
  listId: string,
  userId: string,
  name: string,
): Promise<DataResult<{ list: { id: string; name: string } }>> {
  const existing = await prisma.readingList.findFirst({ where: { id: listId, userId } });
  if (!existing) return { ok: false, error: "List not found", status: 404 };
  const updated = await prisma.readingList.update({ where: { id: listId }, data: { name } });
  return { ok: true, list: { id: updated.id, name: updated.name } };
}

/**
 * Deletes a list. Ownership-checked. Refuses (409) to delete the default list
 * since it is automatically managed — the user should just remove items.
 */
export async function deleteList(
  listId: string,
  userId: string,
): Promise<SimpleResult> {
  const existing = await prisma.readingList.findFirst({ where: { id: listId, userId } });
  if (!existing) return { ok: false, error: "List not found", status: 404 };
  if (existing.isDefault) {
    return { ok: false, error: "Cannot delete the default list", status: 409 };
  }
  await prisma.readingList.delete({ where: { id: listId } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * Adds an article to a list. Idempotent — adding an article already in the
 * list returns ok without error. Both the list ownership and the article's
 * existence are checked; either missing yields 404.
 */
export async function addToList(
  listId: string,
  userId: string,
  articleId: string,
): Promise<SimpleResult> {
  const list = await prisma.readingList.findFirst({ where: { id: listId, userId } });
  if (!list) return { ok: false, error: "List not found", status: 404 };
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) return { ok: false, error: "Article not found", status: 404 };
  // Idempotent: upsert with a no-op update so duplicate adds are safe.
  await prisma.readingListItem.upsert({
    where: { listId_articleId: { listId, articleId } },
    create: { listId, articleId },
    update: {},
  });
  return { ok: true };
}

/**
 * Removes an article from a list. Idempotent — removing an article that isn't
 * in the list returns ok. List ownership is checked; 404 if missing or not owned.
 */
export async function removeFromList(
  listId: string,
  userId: string,
  articleId: string,
): Promise<SimpleResult> {
  const list = await prisma.readingList.findFirst({ where: { id: listId, userId } });
  if (!list) return { ok: false, error: "List not found", status: 404 };
  await prisma.readingListItem.deleteMany({ where: { listId, articleId } });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Quick bookmark (default-list toggle)
// ---------------------------------------------------------------------------

/**
 * Toggles an article in the user's default "Saved" list:
 * - Not bookmarked → adds it, returns `{ok:true, bookmarked:true}`.
 * - Already bookmarked → removes it, returns `{ok:true, bookmarked:false}`.
 * - Article not found → returns `{ok:false, error, status:404}`.
 *
 * The default list is lazily created on first toggle.
 */
export async function toggleBookmark(
  userId: string,
  articleId: string,
): Promise<DataResult<{ bookmarked: boolean }>> {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) return { ok: false, error: "Article not found", status: 404 };

  const defaultList = await getOrCreateDefaultList(userId);
  const existing = await prisma.readingListItem.findUnique({
    where: { listId_articleId: { listId: defaultList.id, articleId } },
  });

  if (existing) {
    await prisma.readingListItem.delete({ where: { id: existing.id } });
    return { ok: true, bookmarked: false };
  } else {
    await prisma.readingListItem.create({ data: { listId: defaultList.id, articleId } });
    return { ok: true, bookmarked: true };
  }
}

// ---------------------------------------------------------------------------
// Batch bookmark state for listings
// ---------------------------------------------------------------------------

/**
 * Given a list of article ids (e.g. those rendered on a listing page), returns
 * the subset that the user has bookmarked in **any** of their reading lists.
 *
 * This is intentionally "any list" rather than "default list only" so that
 * listing cards reflect the saved state regardless of which list an article
 * was added to — consistent with how saved words appear in the study list.
 *
 * Usage: call once per page render with all visible article ids; use the
 * returned Set to show the bookmark icon on matching cards.
 */
export async function getBookmarkedArticleIds(
  userId: string,
  articleIds: string[],
): Promise<Set<string>> {
  if (articleIds.length === 0) return new Set();

  const lists = await prisma.readingList.findMany({
    where: { userId },
    select: { id: true },
  });
  if (lists.length === 0) return new Set();

  const listIds = lists.map((l) => l.id);
  const items = await prisma.readingListItem.findMany({
    where: { listId: { in: listIds }, articleId: { in: articleIds } },
    select: { articleId: true },
  });
  return new Set(items.map((i) => i.articleId));
}

// ---------------------------------------------------------------------------
// List-picker membership (article ↔ all user lists)
// ---------------------------------------------------------------------------

export type ListMembership = {
  id: string;
  name: string;
  isDefault: boolean;
  hasArticle: boolean;
};

/**
 * Returns all of the user's lists annotated with whether a given article is
 * in each list. Used by the list-picker popover so Linus can render the
 * checkbox state in a single request.
 *
 * Default list is first (same ordering as getUserLists). Returns an empty
 * array when the article does not exist; the route maps this to 404.
 */
export async function getArticleListMembership(
  userId: string,
  articleId: string,
): Promise<ListMembership[] | null> {
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { id: true } });
  if (!article) return null;

  const lists = await prisma.readingList.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: {
      items: {
        where: { articleId },
        select: { id: true },
      },
    },
  });

  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    isDefault: l.isDefault,
    hasArticle: l.items.length > 0,
  }));
}
