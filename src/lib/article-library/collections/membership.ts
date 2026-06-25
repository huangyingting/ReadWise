/**
 * List-picker membership queries (REF-042).
 *
 * Returns visibility-annotated list membership for a given article so the UI
 * can show which lists already contain it. Article readability is enforced so
 * drafts and foreign private imports cannot be used as existence oracles.
 */
import { prisma } from "@/lib/prisma";
import { getReadableArticleById } from "../policy";

export type ListMembership = {
  id: string;
  name: string;
  isDefault: boolean;
  hasArticle: boolean;
};

/**
 * Returns all of the user's lists annotated with whether a given article is in
 * each list. Returns null when the article does not exist or is not viewable.
 */
export async function getArticleListMembership(
  userId: string,
  articleId: string,
  role?: string | null,
): Promise<ListMembership[] | null> {
  const article = await getReadableArticleById(articleId, { role, userId });
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
