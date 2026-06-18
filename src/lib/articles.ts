import { prisma } from "@/lib/prisma";
import type { Article } from "@prisma/client";
import {
  levelRank,
  ensureArticleDifficulties,
  type DifficultyLevel,
} from "@/lib/difficulty";

const WORDS_PER_MINUTE = 200;

/** Articles fetched per page in the browse/category listings. */
export const BROWSE_PAGE_SIZE = 6;

export function getArticleById(id: string): Promise<Article | null> {
  return prisma.article.findUnique({ where: { id } });
}

export function listPublishedArticles(limit = 12): Promise<Article[]> {
  return prisma.article.findMany({
    where: { status: "published" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

/**
 * Filters articles to those at or below `maxLevel` (appropriate, not too hard)
 * and sorts them easiest-first by difficulty. Articles without an assessed
 * difficulty are treated as the hardest so they sort last but are not dropped.
 * Used to surface level-appropriate recommendations for a reader.
 */
export function filterAndSortByLevel(
  articles: Article[],
  maxLevel?: DifficultyLevel | null,
): Article[] {
  const max = maxLevel ? levelRank(maxLevel) : null;
  const rankOf = (a: Article): number => {
    const rank = a.difficulty ? levelRank(a.difficulty) : -1;
    return rank === -1 ? Number.POSITIVE_INFINITY : rank;
  };

  const filtered =
    max == null
      ? [...articles]
      : articles.filter((a) => {
          const rank = rankOf(a);
          return Number.isFinite(rank) && rank <= max;
        });

  return filtered.sort((a, b) => {
    const diff = rankOf(a) - rankOf(b);
    if (diff !== 0) {
      return diff;
    }
    return (a.difficultyScore ?? 0) - (b.difficultyScore ?? 0);
  });
}

export function countWords(text: string): number {
  const stripped = text.replace(/<[^>]*>/g, " ");
  const matches = stripped.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Estimated minutes to read. Prefers the stored value, otherwise derives it
 * from the stored word count or, as a last resort, the body text.
 */
export function readingMinutesFor(article: Article): number | null {
  if (article.readingMinutes != null) {
    return article.readingMinutes;
  }
  const words = article.wordCount ?? countWords(article.content);
  if (words <= 0) {
    return null;
  }
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Plain, serializable shape for an article card (safe to send to the client). */
export type ListingArticle = {
  id: string;
  title: string;
  author: string | null;
  source: string | null;
  category: string | null;
  difficulty: string | null;
  readingMinutes: number | null;
};

export function toListingArticle(article: Article): ListingArticle {
  return {
    id: article.id,
    title: article.title,
    author: article.author,
    source: article.source,
    category: article.category,
    difficulty: article.difficulty,
    readingMinutes: readingMinutesFor(article),
  };
}

export type ArticlePage = {
  articles: Article[];
  hasMore: boolean;
};

/**
 * Fetches one page of published articles, optionally restricted to a category
 * slug. Pass `null` for the category to list across all categories. Returns
 * `hasMore` so callers can offer incremental ("load more") loading.
 */
export async function listCategoryPage(
  category: string | null,
  opts: { offset?: number; limit?: number } = {},
): Promise<ArticlePage> {
  const limit = opts.limit ?? BROWSE_PAGE_SIZE;
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = await prisma.article.findMany({
    where: { status: "published", ...(category ? { category } : {}) },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    skip: offset,
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  return { articles: rows.slice(0, limit), hasMore };
}

/**
 * Personalized "Picks": all published articles filtered/sorted to be
 * level-appropriate for the reader (easiest-first, capped at `maxLevel`),
 * then paginated. Difficulty is ensured (heuristically) for any unassessed
 * articles so the ranking is meaningful.
 */
export async function listPicksPage(
  maxLevel: DifficultyLevel | null,
  opts: { offset?: number; limit?: number } = {},
): Promise<ArticlePage> {
  const limit = opts.limit ?? BROWSE_PAGE_SIZE;
  const offset = Math.max(0, opts.offset ?? 0);
  const all = await prisma.article.findMany({
    where: { status: "published" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
  });
  await ensureArticleDifficulties(all);
  const ranked = filterAndSortByLevel(all, maxLevel);
  return {
    articles: ranked.slice(offset, offset + limit),
    hasMore: offset + limit < ranked.length,
  };
}
