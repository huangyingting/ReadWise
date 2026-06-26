import { prisma } from "@/lib/prisma";
import { CATEGORIES } from "@/lib/categories";
import { ENGLISH_LEVELS } from "@/lib/option-registries";
import { publicListableArticleWhere } from "@/lib/article-library";
import { TagScope } from "@prisma/client";
import { isPostgresDatabase } from "@/lib/db-utils";
import { bucketize } from "@/lib/aggregation";

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

/**
 * Returns the number of distinct users who have at least one `ReadingProgress`
 * row. Uses `COUNT(DISTINCT "userId")` — an index-only aggregate — instead of
 * materialising every row with `groupBy({by:["userId"]})`.
 *
 * Branches on SQLite vs Postgres because Prisma's `queryRaw` passes results
 * through the DB driver: Postgres returns `bigint` for COUNT, SQLite returns
 * `number`. Both are normalised to `number` before returning.
 *
 * Postgres path: double-quoted identifiers (`"ReadingProgress"`, `"userId"`).
 * SQLite path:   unquoted identifiers (SQLite is case-insensitive by default).
 * NOTE: only the SQLite path executes locally; the Postgres path is validated
 * in CI against a Postgres instance.
 */
async function countDistinctUsers(): Promise<number> {
	if (isPostgresDatabase()) {
		const rows = await prisma.$queryRaw<[{ count: bigint }]>`
			SELECT COUNT(DISTINCT "userId") AS count FROM "ReadingProgress"
		`;
		return Number(rows[0]?.count ?? 0);
	}
	const rows = await prisma.$queryRaw<[{ count: number }]>`
		SELECT COUNT(DISTINCT userId) AS count FROM ReadingProgress
	`;
	return Number(rows[0]?.count ?? 0);
}

export async function getAdminAnalytics(): Promise<AdminAnalytics> {
	const [
		categoryGroups,
		levelGroups,
		totalMembers,
		activeReaders,
		readsTracked,
		completedReads,
		savedWords,
		topTagRecords,
	] = await Promise.all([
		prisma.article.groupBy({ by: ["category"], _count: { _all: true } }),
		prisma.article.groupBy({ by: ["difficulty"], _count: { _all: true } }),
		prisma.user.count(),
		countDistinctUsers(),
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

	const articlesByCategory = bucketize(
		CATEGORIES.map((c) => ({ key: c.slug, label: c.label })),
		categoryGroups.map((g) => ({ key: g.category, count: g._count._all })),
		{ key: "uncategorized", label: "Uncategorized" },
	);

	const articlesByLevel = bucketize(
		ENGLISH_LEVELS.map((lvl) => ({ key: lvl, label: lvl })),
		levelGroups.map((g) => ({ key: g.difficulty, count: g._count._all })),
		{ key: "unassessed", label: "Unassessed" },
	);

	const topTags: BucketCount[] = topTagRecords
		.filter((t) => t._count.articles > 0)
		.map((t) => ({ key: t.slug, label: t.name, count: t._count.articles }));

	return {
		articlesByCategory,
		articlesByLevel,
		memberActivity: {
			totalMembers,
			activeReaders,
			readsTracked,
			completedReads,
			savedWords,
		},
		topTags,
	};
}