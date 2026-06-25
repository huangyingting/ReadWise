/**
 * Article search provider interface and implementations.
 *
 * - `ArticleSearchProvider` — the shared provider interface.
 * - `PrismaArticleSearchProvider` — portable Prisma `contains` provider
 *   (SQLite-safe; PostgreSQL falls back to this when FTS fails).
 * - `postgresTextMatches` — PostgreSQL FTS via `plainto_tsquery`/`ts_rank_cd`;
 *   silently returns `[]` on SQLite or on any query error.
 */
import { prisma } from "@/lib/prisma";
import { Prisma, type Article } from "@prisma/client";
import {
  articleAccessContext,
  isArticleOperator,
  readableArticleWhere,
  type ArticleAccessContext,
} from "@/lib/article-access";
import {
  SEARCH_PAGE_SIZE,
  SEARCH_MAX_LIMIT,
  SEARCH_CANDIDATE_LIMIT,
  type SearchOptions,
  type SearchContext,
  buildSearchTerms,
  isPostgresDatabase,
  candidateTake,
  priorityTake,
  articleTextWhere,
  articleFieldsWhere,
  articleExactWhere,
  TITLE_ARTICLE_SEARCH_FIELDS,
  BYLINE_ARTICLE_SEARCH_FIELDS,
  ARTICLE_SEARCH_FIELDS,
} from "@/lib/search/query";
import { putCandidate, sortCandidates, type SearchCandidate } from "@/lib/search/ranking";
import { userAnnotationArticleIds } from "@/lib/search/annotations";

export type ArticlePage = {
  articles: Article[];
  hasMore: boolean;
};

export type ArticleSearchProvider = {
  name: string;
  search(query: string, opts: SearchOptions, context?: SearchContext | null): Promise<ArticlePage>;
};

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
    return Prisma.sql`((a.status = 'published' AND a.visibility = 'PUBLIC') OR (a.visibility = 'PRIVATE' AND a."ownerId" = ${access.userId}))`;
  }
  return Prisma.sql`(a.status = 'published' AND a.visibility = 'PUBLIC')`;
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
    for (const article of exactTitleMatches) putCandidate(candidates, article, "article");
    for (const article of titleMatches) putCandidate(candidates, article, "article");
    for (const article of exactBylineMatches) putCandidate(candidates, article, "article");
    for (const article of bylineMatches) putCandidate(candidates, article, "article");
    for (const article of exactTextMatches) putCandidate(candidates, article, "article");
    for (const article of postgresMatches) putCandidate(candidates, article, "article");
    for (const article of textMatches) putCandidate(candidates, article, "article");

    const annotationIds = new Set([...annotations.highlightIds, ...annotations.savedWordIds]);
    const missingAnnotationIds = [...annotationIds].filter((id) => !candidates.has(id));
    if (missingAnnotationIds.length > 0) {
      const annotationArticles = await prisma.article.findMany({
        where: readableArticleWhere(access, { id: { in: missingAnnotationIds } }),
        take: missingAnnotationIds.length,
      });
      for (const article of annotationArticles) putCandidate(candidates, article, "article");
    }

    for (const id of annotations.highlightIds) candidates.get(id)?.sources.add("highlight");
    for (const id of annotations.savedWordIds) candidates.get(id)?.sources.add("savedWord");

    const ranked = sortCandidates([...candidates.values()], q, terms);
    const page = ranked.slice(offset, offset + limit);
    const reachableTextMatchCount = Math.min(textMatchCount, SEARCH_CANDIDATE_LIMIT);
    return {
      articles: page.map((candidate) => candidate.article),
      hasMore: ranked.length > offset + limit || reachableTextMatchCount > offset + limit,
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
