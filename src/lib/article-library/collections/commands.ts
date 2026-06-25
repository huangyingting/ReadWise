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
import { type DomainResult, ok, notFound, conflict } from "@/lib/result";
import { getReadableArticleById } from "../policy";
import { getOrCreateDefaultList } from "./default-list-policy";

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
): Promise<DomainResult<{ list: { id: string; name: string } }>> {
  const existing = await prisma.readingList.findFirst({ where: { id: listId, userId } });
  if (!existing) return notFound("List not found");
  const updated = await prisma.readingList.update({ where: { id: listId }, data: { name } });
  return ok({ list: { id: updated.id, name: updated.name } });
}

/**
 * Deletes a list. Ownership-checked. Refuses (409) to delete the default list.
 */
export async function deleteList(
  listId: string,
  userId: string,
): Promise<DomainResult> {
  const existing = await prisma.readingList.findFirst({ where: { id: listId, userId } });
  if (!existing) return notFound("List not found");
  if (existing.isDefault) {
    return conflict("Cannot delete the default list");
  }
  await prisma.readingList.delete({ where: { id: listId } });
  return ok();
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
): Promise<DomainResult> {
  const list = await prisma.readingList.findFirst({ where: { id: listId, userId } });
  if (!list) return notFound("List not found");
  const article = await getReadableArticleById(articleId, { role, userId });
  if (!article) return notFound("Article not found");
  await prisma.readingListItem.upsert({
    where: { listId_articleId: { listId, articleId } },
    create: { listId, articleId },
    update: {},
  });
  return ok();
}

/**
 * Removes an article from a list. Idempotent. List ownership is checked.
 */
export async function removeFromList(
  listId: string,
  userId: string,
  articleId: string,
): Promise<DomainResult> {
  const list = await prisma.readingList.findFirst({ where: { id: listId, userId } });
  if (!list) return notFound("List not found");
  await prisma.readingListItem.deleteMany({ where: { listId, articleId } });
  return ok();
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
): Promise<DomainResult<{ bookmarked: boolean }>> {
  const article = await getReadableArticleById(articleId, { role, userId });
  if (!article) return notFound("Article not found");

  const defaultList = await getOrCreateDefaultList(userId);
  const existing = await prisma.readingListItem.findUnique({
    where: { listId_articleId: { listId: defaultList.id, articleId } },
  });

  if (existing) {
    await prisma.readingListItem.delete({ where: { id: existing.id } });
    return ok({ bookmarked: false });
  } else {
    await prisma.readingListItem.create({ data: { listId: defaultList.id, articleId } });
    return ok({ bookmarked: true });
  }
}
