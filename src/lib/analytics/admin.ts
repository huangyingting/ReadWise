import { prisma } from "@/lib/prisma";
import { CATEGORIES } from "@/lib/categories";
import { ENGLISH_LEVELS } from "@/lib/option-registries";
import { publicListableArticleWhere } from "@/lib/article-library";
import { TagScope } from "@prisma/client";
import { isPostgresDatabase } from "@/lib/db-utils";
import { bucketize } from "@/lib/aggregation";

export type BucketCount = { key: string; label: string; count: number };
type ArticleGroup = { _count: { _all: number } };
type TopTagRecord = { slug: string; name: string; _count: { articles: number } };

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

function toArticleGroupRows<T extends ArticleGroup, K extends keyof T>(
	groups: T[],
	key: K,
): { key: string | null; count: number }[] {
	return groups.map((group) => ({ key: group[key] as string | null, count: group._count._all }));
}

function publicTagCounts(records: TopTagRecord[]): BucketCount[] {
	return records
		.filter((tag) => tag._count.articles > 0)
		.map((tag) => ({ key: tag.slug, label: tag.name, count: tag._count.articles }));
}

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
		toArticleGroupRows(categoryGroups, "category"),
		{ key: "uncategorized", label: "Uncategorized" },
	);

	const articlesByLevel = bucketize(
		ENGLISH_LEVELS.map((lvl) => ({ key: lvl, label: lvl })),
		toArticleGroupRows(levelGroups, "difficulty"),
		{ key: "unassessed", label: "Unassessed" },
	);

	const topTags = publicTagCounts(topTagRecords);

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