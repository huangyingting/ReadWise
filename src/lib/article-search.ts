import { prisma } from "@/lib/prisma";
import { Prisma, type Article } from "@prisma/client";
import {
  articleAccessContext,
  isArticleOperator,
  readableArticleWhere,
  type ArticleAccessContext,
} from "@/lib/article-access";

/** Default and maximum page sizes for the user-facing global search. */
export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_MAX_LIMIT = 50;

/** Hard cap for low-priority SQLite-safe Prisma candidate buckets; PostgreSQL FTS replaces this after #259. */
export const SEARCH_CANDIDATE_LIMIT = 500;

type ArticlePage = {
  articles: Article[];
  hasMore: boolean;
};

type SearchOptions = {
  offset?: number;
  limit?: number;
};

type SearchContext = {
  userId?: string | null;
  role?: string | null;
};

export type ArticleSearchProvider = {
  name: string;
  search(query: string, opts: SearchOptions, context?: SearchContext | null): Promise<ArticlePage>;
};

const ARTICLE_SEARCH_FIELDS = ["title", "excerpt", "content", "author", "source", "category"] as const;
const TITLE_ARTICLE_SEARCH_FIELDS = ["title"] as const;
const BYLINE_ARTICLE_SEARCH_FIELDS = ["author", "source"] as const;
const HIGHLIGHT_SEARCH_FIELDS = ["quote", "note"] as const;
const SAVED_WORD_SEARCH_FIELDS = ["word", "explanation", "example", "contextSentence"] as const;

type SearchSource = "article" | "highlight" | "savedWord";

type SearchCandidate = {
  article: Article;
  sources: Set<SearchSource>;
};

type StringContainsFilter = { contains: string; mode?: "insensitive" };

/**
 * Tokenizes a user query for portable Prisma `contains` searches. This avoids
 * SQLite FTS5 syntax entirely today while keeping the call site behind
 * ArticleSearchProvider so a PostgreSQL tsvector/ts_rank implementation can be
 * dropped in after the PostgreSQL migration in #259.
 */
export function buildSearchTerms(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .trim()
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((term) => term.trim())
        .filter((term) => term.length > 0)
        .slice(0, 8),
    ),
  );
}

function isPostgresDatabase(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

function containsFilter(value: string): StringContainsFilter {
  return isPostgresDatabase() ? { contains: value, mode: "insensitive" } : { contains: value };
}

function candidateTake(offset: number, limit: number): number {
  return Math.min(SEARCH_CANDIDATE_LIMIT, Math.max(limit + 1, offset + limit + 1 + 50));
}

function priorityTake(offset: number, limit: number): number {
  return Math.min(SEARCH_CANDIDATE_LIMIT, offset + limit + 1);
}

function articleFieldsWhere(
  fields: readonly (typeof ARTICLE_SEARCH_FIELDS)[number][],
  terms: string[],
): Prisma.ArticleWhereInput {
  const perTerm = terms.map((term) => ({
    OR: fields.map((field) => ({ [field]: containsFilter(term) })),
  })) as Prisma.ArticleWhereInput[];
  return perTerm.length === 1 ? perTerm[0] : { AND: perTerm };
}

function articleTextWhere(terms: string[]): Prisma.ArticleWhereInput {
  return articleFieldsWhere(ARTICLE_SEARCH_FIELDS, terms);
}

function articleExactWhere(
  fields: readonly (typeof ARTICLE_SEARCH_FIELDS)[number][],
  query: string,
): Prisma.ArticleWhereInput {
  return { OR: fields.map((field) => ({ [field]: containsFilter(query) })) };
}

function highlightTextWhere(terms: string[]): Prisma.HighlightWhereInput {
  const perTerm = terms.map((term) => ({
    OR: HIGHLIGHT_SEARCH_FIELDS.map((field) => ({ [field]: containsFilter(term) })),
  })) as Prisma.HighlightWhereInput[];
  return perTerm.length === 1 ? perTerm[0] : { AND: perTerm };
}

function savedWordTextWhere(terms: string[]): Prisma.SavedWordWhereInput {
  const perTerm = terms.map((term) => ({
    OR: SAVED_WORD_SEARCH_FIELDS.map((field) => ({ [field]: containsFilter(term) })),
  })) as Prisma.SavedWordWhereInput[];
  return perTerm.length === 1 ? perTerm[0] : { AND: perTerm };
}

function recencyTime(article: Pick<Article, "publishedAt" | "createdAt">): number {
  return (article.publishedAt ?? article.createdAt).getTime();
}

function lower(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function fieldScore(value: string | null | undefined, query: string, terms: string[], weight: number): number {
  const haystack = lower(value);
  if (!haystack) return 0;
  let score = haystack.includes(query) ? weight * 2 : 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += weight;
  }
  return score;
}

export function scoreArticleSearchCandidate(
  article: Article,
  query: string,
  terms: string[],
  sources: Iterable<SearchSource>,
): number {
  const sourceSet = sources instanceof Set ? sources : new Set(sources);
  let score = 0;
  score += fieldScore(article.title, query, terms, 60);
  score += fieldScore(article.excerpt, query, terms, 28);
  score += fieldScore(article.author, query, terms, 22);
  score += fieldScore(article.source, query, terms, 22);
  score += fieldScore(article.category, query, terms, 12);
  score += fieldScore(article.content, query, terms, 10);
  if (sourceSet.has("highlight")) score += 45;
  if (sourceSet.has("savedWord")) score += 35;
  if (article.ownerId) score += 20;
  return score;
}

function putCandidate(
  candidates: Map<string, SearchCandidate>,
  article: Article,
  source: SearchSource,
): void {
  const existing = candidates.get(article.id);
  if (existing) {
    existing.sources.add(source);
    return;
  }
  candidates.set(article.id, { article, sources: new Set([source]) });
}

function sortCandidates(candidates: SearchCandidate[], query: string, terms: string[]): SearchCandidate[] {
  return candidates.sort((a, b) => {
    const scoreDiff =
      scoreArticleSearchCandidate(b.article, query, terms, b.sources) -
      scoreArticleSearchCandidate(a.article, query, terms, a.sources);
    if (scoreDiff !== 0) return scoreDiff;
    const dateDiff = recencyTime(b.article) - recencyTime(a.article);
    if (dateDiff !== 0) return dateDiff;
    return a.article.title.localeCompare(b.article.title);
  });
}

async function userAnnotationArticleIds(
  userId: string | null | undefined,
  terms: string[],
  take: number,
): Promise<{ highlightIds: string[]; savedWordIds: string[] }> {
  if (!userId) return { highlightIds: [], savedWordIds: [] };
  const [highlightMatches, vocabMatches] = await Promise.all([
    prisma.highlight.findMany({
      where: { userId, ...highlightTextWhere(terms) },
      select: { articleId: true },
      distinct: ["articleId"],
      take,
    }),
    prisma.savedWord.findMany({
      where: { userId, articleId: { not: null }, ...savedWordTextWhere(terms) },
      select: { articleId: true },
      take,
    }),
  ]);
  return {
    highlightIds: [...new Set(highlightMatches.map((row) => row.articleId))],
    savedWordIds: [
      ...new Set(vocabMatches.flatMap((row) => (row.articleId ? [row.articleId] : []))),
    ],
  };
}

function accessContext(context?: SearchContext | null): ArticleAccessContext | null {
  if (!context?.userId && !context?.role) return null;
  return articleAccessContext({
    id: context.userId ?? null,
    role: context.role ?? null,
  });
}

function postgresReadableSql(access: ArticleAccessContext | null): Prisma.Sql {
  if (isArticleOperator(access)) return Prisma.sql`TRUE`;
  if (access?.userId) {
    return Prisma.sql`((a.status = 'published' AND a."ownerId" IS NULL) OR a."ownerId" = ${access.userId})`;
  }
  return Prisma.sql`(a.status = 'published' AND a."ownerId" IS NULL)`;
}

async function postgresTextMatches(
  query: string,
  access: ArticleAccessContext | null,
  take: number,
): Promise<Article[]> {
  if (!isPostgresDatabase()) return [];
  try {
    const visibility = postgresReadableSql(access);
    return await prisma.$queryRaw<Article[]>`
      WITH ranked AS (
        SELECT
          a.*,
          ts_rank_cd(
            to_tsvector('english', coalesce(a.title, '') || ' ' || coalesce(a.excerpt, '') || ' ' || coalesce(a.content, '')),
            plainto_tsquery('english', ${query})
          ) AS "_searchRank"
        FROM "Article" a
        WHERE ${visibility}
          AND to_tsvector('english', coalesce(a.title, '') || ' ' || coalesce(a.excerpt, '') || ' ' || coalesce(a.content, ''))
              @@ plainto_tsquery('english', ${query})
      )
      SELECT *
      FROM ranked
      ORDER BY "_searchRank" DESC, "publishedAt" DESC NULLS LAST, "createdAt" DESC
      LIMIT ${take}
    `;
  } catch {
    return [];
  }
}

export class PrismaArticleSearchProvider implements ArticleSearchProvider {
  name = "prisma-like";

  async search(query: string, opts: SearchOptions = {}, context?: SearchContext | null): Promise<ArticlePage> {
    const q = query.trim().toLowerCase();
    const terms = buildSearchTerms(q);
    if (terms.length === 0) {
      return { articles: [], hasMore: false };
    }

    const limit = Math.min(opts.limit ?? SEARCH_PAGE_SIZE, SEARCH_MAX_LIMIT);
    const offset = Math.max(0, opts.offset ?? 0);
    const broadTake = candidateTake(offset, limit);
    const highPriorityTake = priorityTake(offset, limit);
    const access = accessContext(context);
    const readableTextWhere = readableArticleWhere(access, articleTextWhere(terms));

    const [
      textMatchCount,
      exactTitleMatches,
      titleMatches,
      exactBylineMatches,
      bylineMatches,
      exactTextMatches,
      postgresMatches,
      textMatches,
      annotations,
    ] = await Promise.all([
      prisma.article.count({ where: readableTextWhere }),
      prisma.article.findMany({
        where: readableArticleWhere(access, articleExactWhere(TITLE_ARTICLE_SEARCH_FIELDS, q)),
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: highPriorityTake,
      }),
      prisma.article.findMany({
        where: readableArticleWhere(access, articleFieldsWhere(TITLE_ARTICLE_SEARCH_FIELDS, terms)),
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: highPriorityTake,
      }),
      prisma.article.findMany({
        where: readableArticleWhere(access, articleExactWhere(BYLINE_ARTICLE_SEARCH_FIELDS, q)),
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: highPriorityTake,
      }),
      prisma.article.findMany({
        where: readableArticleWhere(access, articleFieldsWhere(BYLINE_ARTICLE_SEARCH_FIELDS, terms)),
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: highPriorityTake,
      }),
      prisma.article.findMany({
        where: readableArticleWhere(access, articleExactWhere(ARTICLE_SEARCH_FIELDS, q)),
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: highPriorityTake,
      }),
      postgresTextMatches(q, access, broadTake),
      prisma.article.findMany({
        where: readableTextWhere,
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: broadTake,
      }),
      userAnnotationArticleIds(context?.userId, terms, broadTake),
    ]);

    const candidates = new Map<string, SearchCandidate>();
    for (const article of exactTitleMatches) {
      putCandidate(candidates, article, "article");
    }
    for (const article of titleMatches) {
      putCandidate(candidates, article, "article");
    }
    for (const article of exactBylineMatches) {
      putCandidate(candidates, article, "article");
    }
    for (const article of bylineMatches) {
      putCandidate(candidates, article, "article");
    }
    for (const article of exactTextMatches) {
      putCandidate(candidates, article, "article");
    }
    for (const article of postgresMatches) {
      putCandidate(candidates, article, "article");
    }
    for (const article of textMatches) {
      putCandidate(candidates, article, "article");
    }

    const annotationIds = new Set([...annotations.highlightIds, ...annotations.savedWordIds]);
    const missingAnnotationIds = [...annotationIds].filter((id) => !candidates.has(id));
    if (missingAnnotationIds.length > 0) {
      const annotationArticles = await prisma.article.findMany({
        where: readableArticleWhere(access, { id: { in: missingAnnotationIds } }),
        take: missingAnnotationIds.length,
      });
      for (const article of annotationArticles) {
        putCandidate(candidates, article, "article");
      }
    }

    for (const id of annotations.highlightIds) {
      candidates.get(id)?.sources.add("highlight");
    }
    for (const id of annotations.savedWordIds) {
      candidates.get(id)?.sources.add("savedWord");
    }

    const ranked = sortCandidates([...candidates.values()], q, terms);
    const page = ranked.slice(offset, offset + limit);
    return {
      articles: page.map((candidate) => candidate.article),
      hasMore: ranked.length > offset + limit || textMatchCount > offset + limit,
    };
  }
}

const provider = new PrismaArticleSearchProvider();

export function getArticleSearchProvider(): ArticleSearchProvider {
  return provider;
}

/**
 * Backwards-compatible article search entry point used by `/api/search`.
 * Despite the historical name, authenticated users may also see their own
 * imported articles and their own annotation/vocabulary matches; all results
 * pass through `readableArticleWhere` to preserve Wave 1 visibility rules.
 */
export function searchPublishedArticles(
  query: string,
  opts: SearchOptions = {},
  userId?: string,
): Promise<ArticlePage> {
  return getArticleSearchProvider().search(query, opts, userId ? { userId, role: "Reader" } : null);
}
