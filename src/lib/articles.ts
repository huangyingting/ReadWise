import { prisma } from "@/lib/prisma";
import { ArticleStatus, type Article, type Prisma } from "@prisma/client";
import {
  levelRank,
  levelsAtOrBelow,
  ensureArticleDifficulties,
  type DifficultyLevel,
} from "@/lib/difficulty";
import { createCachedListing, ARTICLES_CACHE_TAG } from "@/lib/cache";
import {
  articleAccessContext,
  getPublicListableArticleById,
  getReadableArticleById,
  ownedArticleWhere,
  publicListableArticleWhere,
  readableArticleWhere,
} from "@/lib/article-access";

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
 *   - All other users may only view published public articles.
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

function isPostgresDatabase(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

/**
 * Full-text search over published articles via the active database engine.
 * SQLite uses FTS5 (article_fts); PostgreSQL uses a tsvector expression index.
 * Degrades gracefully to a Prisma LIKE fallback when FTS is unavailable.
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
  const context = userId
    ? articleAccessContext({ id: userId, role: "Reader" })
    : null;

  // Per-user: collect article IDs from highlights, saved words, and the user's
  // OWN imported (personal) articles that match the query, to merge into the
  // ranked results. Personal imports have `ownerId === userId` and are excluded
  // from the public FTS / LIKE paths below, so they only surface via this merge.
  const userArticleIds: string[] = [];
  if (userId) {
    const [highlightMatches, vocabMatches, personalMatches] = await Promise.all([
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
      prisma.article.findMany({
        where: ownedArticleWhere(userId, {
          status: ArticleStatus.PUBLISHED,
          OR: [
            { title: { contains: q } },
            { author: { contains: q } },
            { source: { contains: q } },
          ],
        }),
        select: { id: true },
        orderBy: [{ createdAt: "desc" }],
      }),
    ]);
    const ids = new Set<string>();
    // Personal imports first so the user's own articles rank ahead of merged
    // annotation matches.
    for (const p of personalMatches) ids.add(p.id);
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
      const take = limit + 1 + userArticleIds.length;
      const ftsRows = isPostgresDatabase()
        ? await prisma.$queryRaw<FtsRow[]>`
            WITH ranked AS (
              SELECT
                a.id,
                ts_rank_cd(
                  to_tsvector('english', coalesce(a.title, '') || ' ' || coalesce(a.excerpt, '') || ' ' || coalesce(a.content, '')),
                  plainto_tsquery('english', ${q})
                ) AS rank,
                a."publishedAt"
              FROM "Article" a
              WHERE to_tsvector('english', coalesce(a.title, '') || ' ' || coalesce(a.excerpt, '') || ' ' || coalesce(a.content, ''))
                    @@ plainto_tsquery('english', ${q})
                AND a.status = 'published'
                AND a.visibility = 'PUBLIC'
            )
            SELECT id, rank
            FROM ranked
            ORDER BY rank DESC, "publishedAt" DESC
            LIMIT ${take} OFFSET ${offset}
          `
        : await prisma.$queryRaw<FtsRow[]>`
           -- bm25() returns negative values — ORDER BY ASC puts best matches first.
           SELECT a.id, bm25(article_fts) AS rank
           FROM article_fts
           JOIN "Article" a ON a.rowid = article_fts.rowid
           WHERE article_fts MATCH ${ftsQuery}
             AND a.status = 'published'
             AND a.visibility = 'PUBLIC'
           ORDER BY rank ASC, a."publishedAt" DESC
           LIMIT ${take} OFFSET ${offset}
          `;

      // Build ordered id list: FTS-ranked ids first, then per-user extras not
      // already in the ranked set. Annotation IDs are only appended on the
      // first page (offset === 0) to prevent duplicates across pages.
      const seen = new Set(ftsRows.map((r) => r.id));
      const orderedIds = [
        ...ftsRows.map((r) => r.id),
        ...(offset === 0 ? userArticleIds.filter((id) => !seen.has(id)) : []),
      ];

      const hasMore = orderedIds.length > limit;
      const pageIds = orderedIds.slice(0, limit);

      // Only return from the FTS path when it (or the per-user merge) produced
      // ids. When FTS matches nothing — e.g. the query is an author/source/
      // category term that doesn't appear in the indexed title/content — fall
      // through to the LIKE fallback below, which searches title/author/source.
      if (pageIds.length > 0) {
        // Fetch full Article rows for the page, preserving ranked order. Allow
        // the caller's own personal imports (ownerId === userId) in addition to
        // public articles so merged personal matches resolve to rows.
        const byId = new Map<string, Article>();
        const rows = await prisma.article.findMany({
          where: readableArticleWhere(context, {
            id: { in: pageIds },
            status: ArticleStatus.PUBLISHED,
          }),
        });
        for (const r of rows) byId.set(r.id, r);
        const articles = pageIds.flatMap((id) => {
          const a = byId.get(id);
          return a ? [a] : [];
        });

        return { articles, hasMore };
      }
      // FTS returned no ids — fall through to the LIKE fallback.
    } catch {
      // FTS unavailable — fall through to LIKE path.
    }
  }

  // Fallback: title/author/source LIKE + optional per-user article IDs.
  const textClauses: Prisma.ArticleWhereInput[] = [
    { title: { contains: q } },
    { author: { contains: q } },
    { source: { contains: q } },
  ];
  // Public articles matching the text, the caller's own imports matching the
  // text, plus any merged per-user IDs (annotations / personal matches).
  const orClauses: Prisma.ArticleWhereInput[] = [
    publicListableArticleWhere({ OR: textClauses }),
    ...(userId ? [ownedArticleWhere(userId, { status: ArticleStatus.PUBLISHED, OR: textClauses })] : []),
  ];
  if (userArticleIds.length > 0) {
    orClauses.push(readableArticleWhere(context, { id: { in: userArticleIds }, status: ArticleStatus.PUBLISHED }));
  }
  const rows = await prisma.article.findMany({
    where: { status: ArticleStatus.PUBLISHED, OR: orClauses },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    skip: offset,
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  return { articles: rows.slice(0, limit), hasMore };
}

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
