/**
 * Reading-list read models (REF-042).
 *
 * Pure query functions — no mutations. All queries are ownership-checked via
 * the userId parameter so IDOR is impossible.
 */
import { prisma } from "@/lib/prisma";
import { toListingArticle, type ListingArticle } from "../mapper";

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

/**
 * Returns all lists for a user, default list first, then oldest-first.
 * Each list includes the number of items it contains.
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
 * list does not exist or belongs to a different user.
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

/**
 * Returns the subset of `articleIds` that the user has bookmarked in any of
 * their reading lists. Call once per page render with all visible article ids.
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
