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
 * Escapes a user query for safe use in FTS5 MATCH expressions.
 * Wraps each whitespace-delimited token in double-quotes so that punctuation
 * and FTS5 operators in user input are treated as literals. Empty tokens are
 * dropped. Returns null when the query is blank / collapses to nothing.
 *
 * Exported for unit testing.
 */
export function buildFtsQuery(raw: string): string | null {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ""))
    .filter(Boolean);
  if (tokens.length === 0) return null;
  // Each token is a prefix match ("word"*) so partial typing works.
  return tokens.map((t) => `"${t}"*`).join(" ");
}

type FtsRow = { id: string; rank: number };

/**
 * Full-text search over published articles via SQLite FTS5 (article_fts).
 * Results are ranked by bm25() relevance (most relevant first). Degrades
 * gracefully to a Prisma LIKE fallback when FTS5 is unavailable.
 *
 * When `userId` is supplied the search is extended to also surface articles
 * that the user has highlighted/annotated or saved vocabulary words from —
 * giving results even when the matched term does not appear in the indexed
 * article text.
 * An empty / blank query returns no results rather than the whole table.
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
  // the query, to merge into the ranked results.
  const userArticleIds: string[] = [];
  if (userId) {
    const [highlightMatches, vocabMatches] = await Promise.all([
      prisma.highlight.findMany({
        where: {
          userId,
          OR: [{ quote: { contains: q } }, { note: { contains: q } }],
        },
        select: { articleId: true },
        distinct: ["articleId"],
      }),
      prisma.savedWord.findMany({
        where: { userId, word: { contains: q }, articleId: { not: null } },
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

  // Attempt FTS5 ranked search. Falls back to LIKE on any error so that a
  // missing / corrupt FTS index doesn't break the feature.
  const ftsQuery = buildFtsQuery(q);
  if (ftsQuery) {
    try {
      // bm25() returns negative values — ORDER BY ASC puts best matches first.
      // We fetch offset + limit + 1 + extra user IDs to handle merging and
      // hasMore detection. The actual pagination window is applied after merge.
      const ftsRows = await prisma.$queryRaw<FtsRow[]>`
        SELECT a.id, bm25(article_fts) AS rank
        FROM article_fts
        JOIN "Article" a ON a.rowid = article_fts.rowid
        WHERE article_fts MATCH ${ftsQuery}
          AND a.status = 'published'
        ORDER BY rank ASC
        LIMIT ${limit + 1 + userArticleIds.length} OFFSET ${offset}
      `;

      // Build ordered id list: FTS-ranked ids first, then per-user extras not
      // already in the ranked set.
      const seen = new Set(ftsRows.map((r) => r.id));
      const orderedIds = [
        ...ftsRows.map((r) => r.id),
        ...userArticleIds.filter((id) => !seen.has(id)),
      ];

      const hasMore = orderedIds.length > limit;
      const pageIds = orderedIds.slice(0, limit);

      if (pageIds.length === 0) return { articles: [], hasMore: false };

      // Fetch full Article rows for the page, preserving ranked order.
      const byId = new Map<string, Article>();
      const rows = await prisma.article.findMany({
        where: { id: { in: pageIds }, status: "published" },
      });
      for (const r of rows) byId.set(r.id, r);
      const articles = pageIds.flatMap((id) => {
        const a = byId.get(id);
        return a ? [a] : [];
      });

      return { articles, hasMore };
    } catch {
      // FTS unavailable — fall through to LIKE path.
    }
  }

  // Fallback: title/author/source LIKE + optional per-user article IDs.
  const orClauses: Prisma.ArticleWhereInput[] = [
    { title: { contains: q } },
    { author: { contains: q } },
    { source: { contains: q } },
  ];
  if (userArticleIds.length > 0) {
    orClauses.push({ id: { in: userArticleIds } });
  }
  const rows = await prisma.article.findMany({
    where: { status: "published", OR: orClauses },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    skip: offset,
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  return { articles: rows.slice(0, limit), hasMore };
}
