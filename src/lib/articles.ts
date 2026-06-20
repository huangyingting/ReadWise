import { prisma } from "@/lib/prisma";
import type { Article, Prisma } from "@prisma/client";
import {
  levelRank,
  ensureArticleDifficulties,
  type DifficultyLevel,
} from "@/lib/difficulty";
import { createCachedListing, ARTICLES_CACHE_TAG } from "@/lib/cache";

const WORDS_PER_MINUTE = 200;

/** Articles fetched per page in the browse/category listings. */
export const BROWSE_PAGE_SIZE = 6;

export function getArticleById(id: string): Promise<Article | null> {
  return prisma.article.findUnique({ where: { id } });
}

/**
 * Returns the article if the requester is allowed to view it:
 *   - Admins may view any article (including drafts).
 *   - All other users may only view published articles.
 * Returns null when the article does not exist or is not viewable.
 */
export function getViewableArticleById(
  id: string,
  role?: string | null,
): Promise<Article | null> {
  if (role === "Admin") {
    return prisma.article.findUnique({ where: { id } });
  }
  return prisma.article.findUnique({ where: { id, status: "published" } });
}

export function listPublishedArticles(limit = 12): Promise<Article[]> {
  return cachedListPublishedArticles(limit);
}

function listPublishedArticlesUncached(limit = 12): Promise<Article[]> {
  return prisma.article.findMany({
    where: { status: "published" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

const cachedListPublishedArticles = createCachedListing(
  listPublishedArticlesUncached,
  ["articles:published"],
  [ARTICLES_CACHE_TAG],
);

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
  return cachedListCategoryPage(category, offset, limit);
}

async function listCategoryPageImpl(
  category: string | null,
  offset: number,
  limit: number,
): Promise<ArticlePage> {
  const rows = await prisma.article.findMany({
    where: { status: "published", ...(category ? { category } : {}) },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    skip: offset,
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  return { articles: rows.slice(0, limit), hasMore };
}

const cachedListCategoryPage = createCachedListing(
  listCategoryPageImpl,
  ["articles:category-page"],
  [ARTICLES_CACHE_TAG],
);

/**
 * Ranks articles for a reader's personalized "Picks" feed. Articles are first
 * filtered/sorted to be level-appropriate (easiest-first, capped at `maxLevel`),
 * then articles whose category matches one of the reader's preferred `topics`
 * are surfaced ahead of the rest (preserving the level ordering within each
 * group). When the profile is sparse — no level and/or no topics — this
 * degrades sensibly: no topics means the plain level ranking, no level means
 * all articles are eligible, and no topic matches simply falls back to the
 * level-ranked remainder rather than returning nothing.
 */
export function rankPicks(
  articles: Article[],
  maxLevel: DifficultyLevel | null,
  topics: string[] = [],
): Article[] {
  const ranked = filterAndSortByLevel(articles, maxLevel);
  const topicSet = new Set(topics.filter(Boolean));
  if (topicSet.size === 0) {
    return ranked;
  }
  const matched: Article[] = [];
  const rest: Article[] = [];
  for (const article of ranked) {
    if (article.category && topicSet.has(article.category)) {
      matched.push(article);
    } else {
      rest.push(article);
    }
  }
  return [...matched, ...rest];
}

/**
 * Personalized "Picks": all published articles ranked to be both
 * level-appropriate and aligned with the reader's preferred topics (see
 * {@link rankPicks}), then paginated. Difficulty is ensured (heuristically)
 * for any unassessed articles so the ranking is meaningful.
 */
export async function listPicksPage(
  maxLevel: DifficultyLevel | null,
  topics: string[] = [],
  opts: { offset?: number; limit?: number } = {},
): Promise<ArticlePage> {
  const limit = opts.limit ?? BROWSE_PAGE_SIZE;
  const offset = Math.max(0, opts.offset ?? 0);
  return cachedListPicksPage(maxLevel, topics, offset, limit);
}

/** Maximum articles fetched from DB for in-memory picks ranking. */
const MAX_PICKS_FETCH = 500;

async function listPicksPageImpl(
  maxLevel: DifficultyLevel | null,
  topics: string[],
  offset: number,
  limit: number,
): Promise<ArticlePage> {
  const all = await prisma.article.findMany({
    where: { status: "published" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: MAX_PICKS_FETCH,
  });
  await ensureArticleDifficulties(all);
  const ranked = rankPicks(all, maxLevel, topics);
  return {
    articles: ranked.slice(offset, offset + limit),
    hasMore: offset + limit < ranked.length,
  };
}

const cachedListPicksPage = createCachedListing(
  listPicksPageImpl,
  ["articles:picks-page"],
  [ARTICLES_CACHE_TAG],
);

/** Default and maximum page sizes for the user-facing global search. */
export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_MAX_LIMIT = 50;

/**
 * Searches published articles by title, author, source, or body content using a
 * case-insensitive LIKE match (SQLite LIKE is case-insensitive for ASCII).
 * When `userId` is supplied the search is extended to also surface articles that
 * the user has highlighted/annotated or saved vocabulary words from — giving
 * results even when the matched term does not appear in the article metadata.
 * An empty / blank query returns no results rather than the whole table.
 * Results are uncached because they are query-dependent and also merged with
 * per-user progress data in the route.
 */
export async function searchPublishedArticles(
  query: string,
  opts: { offset?: number; limit?: number } = {},
  userId?: string,
): Promise<ArticlePage> {
  const q = query.trim();
  if (!q) {
    return { articles: [], hasMore: false };
  }
  const limit = Math.min(opts.limit ?? SEARCH_PAGE_SIZE, SEARCH_MAX_LIMIT);
  const offset = Math.max(0, opts.offset ?? 0);

  // Per-user: collect article IDs from highlights and saved words that match
  // the query. These run in parallel and feed into the main article OR clause
  // so that pagination (skip/take) stays correct with a single DB query.
  const userArticleIds: string[] = [];
  if (userId) {
    const [highlightMatches, vocabMatches] = await Promise.all([
      prisma.highlight.findMany({
        where: {
          userId,
          OR: [
            { quote: { contains: q } },
            { note: { contains: q } },
          ],
        },
        select: { articleId: true },
        distinct: ["articleId"],
      }),
      prisma.savedWord.findMany({
        where: {
          userId,
          word: { contains: q },
          articleId: { not: null },
        },
        select: { articleId: true },
      }),
    ]);

    const ids = new Set<string>();
    for (const h of highlightMatches) ids.add(h.articleId);
    for (const sw of vocabMatches) {
      if (sw.articleId) ids.add(sw.articleId);
    }
    userArticleIds.push(...ids);
  }

  // Build OR clauses: article metadata (title/author/source) + per-user article IDs.
  // Intentionally excludes full-body { content: contains: q } — a LIKE scan over
  // the full HTML content column is O(N*content_size) with no FTS5 index and
  // becomes prohibitively slow as the corpus grows (PERF-4 / issue #72).
  // Full-text body search will be re-introduced via FTS5 in issue #41.
  const orClauses: Prisma.ArticleWhereInput[] = [
    { title: { contains: q } },
    { author: { contains: q } },
    { source: { contains: q } },
  ];
  if (userArticleIds.length > 0) {
    orClauses.push({ id: { in: userArticleIds } });
  }

  const rows = await prisma.article.findMany({
    where: {
      status: "published",
      OR: orClauses,
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    skip: offset,
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  return { articles: rows.slice(0, limit), hasMore };
}
