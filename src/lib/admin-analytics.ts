import { prisma } from "@/lib/prisma";
import { CATEGORIES } from "@/lib/categories";
import { ENGLISH_LEVELS } from "@/lib/option-registries";
import { publicListableArticleWhere } from "@/lib/article-library";
import { TagScope } from "@prisma/client";

export type BucketCount = { key: string; label: string; count: number };

export type AdminAnalytics = {
  articlesByCategory: BucketCount[];
  articlesByLevel: BucketCount[];
  memberActivity: {
    totalMembers: number;
    activeReaders: number;
    readsTracked: number;
    completedReads: number;
    savedWords: number;
  };
  topTags: BucketCount[];
};

export async function getAdminAnalytics(): Promise<AdminAnalytics> {
  const [
    categoryGroups,
    levelGroups,
    totalMembers,
    activeReaderGroups,
    readsTracked,
    completedReads,
    savedWords,
    topTagRecords,
  ] = await Promise.all([
    prisma.article.groupBy({ by: ["category"], _count: { _all: true } }),
    prisma.article.groupBy({ by: ["difficulty"], _count: { _all: true } }),
    prisma.user.count(),
    prisma.readingProgress.groupBy({ by: ["userId"] }),
    prisma.readingProgress.count(),
    prisma.readingProgress.count({ where: { completed: true } }),
    prisma.savedWord.count(),
    prisma.tag.findMany({
      where: { scope: TagScope.PUBLIC },
      include: {
        _count: { select: { articles: { where: { article: publicListableArticleWhere() } } } },
      },
      orderBy: { articles: { _count: "desc" } },
      take: 10,
    }),
  ]);

  const categoryCounts = new Map<string | null, number>();
  for (const g of categoryGroups) {
    categoryCounts.set(g.category, g._count._all);
  }
  const articlesByCategory: BucketCount[] = CATEGORIES.map((c) => ({
    key: c.slug,
    label: c.label,
    count: categoryCounts.get(c.slug) ?? 0,
  }));
  const uncategorized =
    (categoryCounts.get(null) ?? 0) +
    categoryGroups
      .filter(
        (g) =>
          g.category !== null &&
          !CATEGORIES.some((c) => c.slug === g.category),
      )
      .reduce((sum, g) => sum + g._count._all, 0);
  if (uncategorized > 0) {
    articlesByCategory.push({
      key: "uncategorized",
      label: "Uncategorized",
      count: uncategorized,
    });
  }

  const levelCounts = new Map<string | null, number>();
  for (const g of levelGroups) {
    levelCounts.set(g.difficulty, g._count._all);
  }
  const articlesByLevel: BucketCount[] = ENGLISH_LEVELS.map((lvl) => ({
    key: lvl,
    label: lvl,
    count: levelCounts.get(lvl) ?? 0,
  }));
  const unassessed =
    (levelCounts.get(null) ?? 0) +
    levelGroups
      .filter(
        (g) =>
          g.difficulty !== null &&
          !ENGLISH_LEVELS.some((lvl) => lvl === g.difficulty),
      )
      .reduce((sum, g) => sum + g._count._all, 0);
  if (unassessed > 0) {
    articlesByLevel.push({
      key: "unassessed",
      label: "Unassessed",
      count: unassessed,
    });
  }

  const topTags: BucketCount[] = topTagRecords
    .filter((t) => t._count.articles > 0)
    .map((t) => ({ key: t.slug, label: t.name, count: t._count.articles }));

  return {
    articlesByCategory,
    articlesByLevel,
    memberActivity: {
      totalMembers,
      activeReaders: activeReaderGroups.length,
      readsTracked,
      completedReads,
      savedWords,
    },
    topTags,
  };
}
