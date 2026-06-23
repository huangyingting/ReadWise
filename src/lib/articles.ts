import { prisma } from "@/lib/prisma";
import type { Article, Prisma } from "@prisma/client";
import {
  levelRank,
  levelsAtOrBelow,
  ensureArticleDifficulties,
  type DifficultyLevel,
} from "@/lib/difficulty";
import { createCachedListing, ARTICLES_CACHE_TAG } from "@/lib/cache";
import {
  getPublicListableArticleById,
  getReadableArticleById,
  ownedArticleWhere,
  publicListableArticleWhere,
} from "@/lib/article-access";
export {
  SEARCH_MAX_LIMIT,
  SEARCH_PAGE_SIZE,
  buildSearchTerms,
  getArticleSearchProvider,
  searchPublishedArticles,
  scoreArticleSearchCandidate,
} from "@/lib/article-search";

const WORDS_PER_MINUTE = 200;

/** Articles fetched per page in the browse/category listings. */
export const BROWSE_PAGE_SIZE = 6;

export function getArticleById(id: string): Promise<Article | null> {
  return getPublicListableArticleById(id);
}

/**
 * Returns the article if the requester is allowed to view it:
 *   - Admins may view any article (including drafts).
 *   - Owners may view their own personal articles (ownerId === userId).
 *   - All other users may only view published public articles (ownerId IS NULL).
 * Returns null when the article does not exist or is not viewable.
 */
export function getViewableArticleById(
  id: string,
  role?: string | null,
  userId?: string | null,
): Promise<Article | null> {
  return getReadableArticleById(id, { role, userId });
}

export function listPublishedArticles(limit = 12): Promise<Article[]> {
  return cachedListPublishedArticles(limit);
}

function listPublishedArticlesUncached(limit = 12): Promise<Article[]> {
  return prisma.article.findMany({
    where: publicListableArticleWhere(),
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
 * Minimal article shape needed to render a listing card. Accepts full Article
 * rows as well as partial `select`-narrowed rows (e.g. the feed's projection
 * that omits the large `content` HTML), so `content` is optional here.
 */
export type ArticleCardSource = Pick<
  Article,
  | "id"
  | "title"
  | "author"
  | "source"
  | "category"
  | "difficulty"
  | "readingMinutes"
  | "wordCount"
  | "publishedAt"
  | "heroImage"
> & { content?: string | null };

/**
 * Estimated minutes to read. Prefers the stored value, otherwise derives it
 * from the stored word count or, as a last resort, the body text.
 */
export function readingMinutesFor(
  article: Pick<Article, "readingMinutes" | "wordCount"> & { content?: string | null },
): number | null {
  if (article.readingMinutes != null) {
    return article.readingMinutes;
  }
  const words = article.wordCount ?? countWords(article.content ?? "");
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
  publishedAt: string | null;
  heroImage: string | null;
};

export function toListingArticle(article: ArticleCardSource): ListingArticle {
  return {
    id: article.id,
    title: article.title,
    author: article.author,
    source: article.source,
    category: article.category,
    difficulty: article.difficulty,
    readingMinutes: readingMinutesFor(article),
    publishedAt: article.publishedAt instanceof Date
      ? article.publishedAt.toISOString()
      : article.publishedAt
      ? new Date(article.publishedAt).toISOString()
      : null,
    heroImage: article.heroImage ?? null,
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
 *
 * When `maxLevel` is provided, articles are filtered to those at or below that
 * CEFR level and sorted easiest-first (in-memory, like the Picks feed).
 */
export async function listCategoryPage(
  category: string | null,
  opts: { offset?: number; limit?: number; maxLevel?: DifficultyLevel | null } = {},
): Promise<ArticlePage> {
  const limit = opts.limit ?? BROWSE_PAGE_SIZE;
  const offset = Math.max(0, opts.offset ?? 0);
  const maxLevel = opts.maxLevel ?? null;
  return cachedListCategoryPage(category, maxLevel, offset, limit);
}

async function listCategoryPageImpl(
  category: string | null,
  maxLevel: DifficultyLevel | null,
  offset: number,
  limit: number,
): Promise<ArticlePage> {
  const baseWhere: Prisma.ArticleWhereInput = publicListableArticleWhere(
    category ? { category } : undefined,
  );

  if (maxLevel != null) {
    // Level-filtered browse: constrain to assessed articles at/below the level
    // at the DB layer (difficulty IN [...]) and paginate via skip/take instead
    // of loading the whole category into memory. Articles without an assessed
    // difficulty are excluded from a level-filtered view (we can't place them).
    const levelWhere: Prisma.ArticleWhereInput = {
      ...baseWhere,
      difficulty: { in: levelsAtOrBelow(maxLevel) },
    };
    const rows = await prisma.article.findMany({
      where: levelWhere,
      // Easiest-first within the level cap, newest as a tiebreaker — mirrors
      // filterAndSortByLevel's ordering while staying DB-paginated.
      orderBy: [
        { difficultyScore: "asc" },
        { publishedAt: "desc" },
        { createdAt: "desc" },
      ],
      skip: offset,
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    return { articles: rows.slice(0, limit), hasMore };
  }
  // DB-level pagination when no level filter is active.
  const rows = await prisma.article.findMany({
    where: baseWhere,
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
    where: publicListableArticleWhere(),
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

/**
 * Returns personal (user-imported) articles for the given user, newest first.
 * Personal articles have `ownerId === userId` and are never shown to others.
 */
export function listPersonalArticles(
  userId: string,
  limit = 20,
): Promise<Article[]> {
  return prisma.article.findMany({
    where: ownedArticleWhere(userId),
    orderBy: [{ createdAt: "desc" }],
    take: limit,
  });
}

/** Default page size for the personal "My Imports" listing on /import. */
export const IMPORTS_PAGE_SIZE = 20;
export const IMPORTS_MAX_LIMIT = 50;

/**
 * Offset-paginated personal imports for `/import` "Load more". Fetches one extra
 * row beyond `limit` to compute `hasMore` without a separate count query.
 */
export async function listPersonalArticlesPage(
  userId: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<ArticlePage> {
  const limit = Math.min(opts.limit ?? IMPORTS_PAGE_SIZE, IMPORTS_MAX_LIMIT);
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = await prisma.article.findMany({
    where: ownedArticleWhere(userId),
    orderBy: [{ createdAt: "desc" }],
    skip: offset,
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  return { articles: rows.slice(0, limit), hasMore };
}
