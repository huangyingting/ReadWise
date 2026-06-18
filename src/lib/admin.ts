import { prisma } from "@/lib/prisma";

export type StatusCount = { status: string; count: number };

export type AdminOverview = {
  users: number;
  admins: number;
  articles: number;
  published: number;
  tags: number;
  readingProgress: number;
  statusCounts: StatusCount[];
};

export async function getAdminOverview(): Promise<AdminOverview> {
  const [users, admins, articles, published, tags, readingProgress, grouped] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: "Admin" } }),
      prisma.article.count(),
      prisma.article.count({ where: { status: "published" } }),
      prisma.tag.count(),
      prisma.readingProgress.count(),
      prisma.article.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
    ]);

  const statusCounts: StatusCount[] = grouped
    .map((g) => ({ status: g.status, count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  return {
    users,
    admins,
    articles,
    published,
    tags,
    readingProgress,
    statusCounts,
  };
}
