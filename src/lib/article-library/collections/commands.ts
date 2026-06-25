/**
 * Reading-list and bookmark commands (REF-042).
 *
 * Mutations that create, rename, delete, or modify list membership. All
 * commands are ownership-checked: callers supply both the list id and the
 * user id, and a missing-or-wrong-owner list always surfaces as a 404 so
 * IDOR is impossible.
 *
 * Article readability is enforced before adding or toggling to prevent
 * draft/foreign private article leaks.
 *
 * add/remove and toggleBookmark are idempotent: duplicate adds and missing
 * removes return ok without error.
 */
import { prisma } from "@/lib/prisma";
import { getReadableArticleById } from "../policy";
import { getOrCreateDefaultList } from "./default-list-policy";

type ErrResult = { ok: false; error: string; status: number };
type SimpleResult = { ok: true } | ErrResult;
type DataResult<T extends object> = ({ ok: true } & T) | ErrResult;

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
 * Deletes a list. Ownership-checked. Refuses (409) to delete the default list.
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

/**
 * Adds an article to a list. Idempotent. Both the list ownership and the
 * article's visibility are checked: the article must be viewable by the caller
 * via {@link getReadableArticleById}.
 */
export async function addToList(
  listId: string,
  userId: string,
  articleId: string,
  role?: string | null,
): Promise<SimpleResult> {
  const list = await prisma.readingList.findFirst({ where: { id: listId, userId } });
  if (!list) return { ok: false, error: "List not found", status: 404 };
  const article = await getReadableArticleById(articleId, { role, userId });
  if (!article) return { ok: false, error: "Article not found", status: 404 };
  await prisma.readingListItem.upsert({
    where: { listId_articleId: { listId, articleId } },
    create: { listId, articleId },
    update: {},
  });
  return { ok: true };
}

/**
 * Removes an article from a list. Idempotent. List ownership is checked.
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

/**
 * Toggles an article in the user's default "Saved" list. Visibility is
 * enforced via {@link getReadableArticleById} so drafts/foreign imports can't
 * be bookmarked or used as an existence oracle.
 */
export async function toggleBookmark(
  userId: string,
  articleId: string,
  role?: string | null,
): Promise<DataResult<{ bookmarked: boolean }>> {
  const article = await getReadableArticleById(articleId, { role, userId });
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
