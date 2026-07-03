import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { queryString, queryInt } from "@/lib/validation";
import {
  BROWSE_PAGE_SIZE,
  listCategoryPage,
  toListingArticle,
  buildArticleListResponse,
  type ListingArticle,
} from "@/lib/article-library";
import { listScoredPicksPage } from "@/lib/recommendations";
import { getProfile } from "@/features/profile-preferences/repository";
import { parseTopics } from "@/features/profile-preferences/schema";
import { isValidCategorySlug } from "@/lib/categories";
import { isDifficultyLevel, type EnglishLevel } from "@/lib/leveling/cefr-primitives";

const MAX_LIMIT = 24;

type ArticlesQuery = {
  view: string;
  category: string;
  level: string;
  offset: number;
  limit: number;
};

function parseQuery(params: URLSearchParams) {
  const value: ArticlesQuery = {
    view: queryString(params, "view"),
    category: queryString(params, "category"),
    level: queryString(params, "level"),
    offset: queryInt(params, "offset", { fallback: 0, min: 0 }),
    limit: queryInt(params, "limit", {
      fallback: BROWSE_PAGE_SIZE,
      min: 1,
      max: MAX_LIMIT,
    }),
  };
  return { ok: true as const, value };
}

type ArticleListPage = {
  articles: ListingArticle[];
  hasMore: boolean;
};

type PageRequest = Pick<ArticlesQuery, "offset" | "limit">;

function parseLevelParam(levelParam: string): EnglishLevel | null {
  return isDifficultyLevel(levelParam) ? levelParam : null;
}

function parseCategoryParam(categoryParam: string): string | null {
  return categoryParam && categoryParam !== "all" && isValidCategorySlug(categoryParam)
    ? categoryParam
    : null;
}

async function listPicksArticles(
  userId: string,
  urlLevel: EnglishLevel | null,
  page: PageRequest,
): Promise<ArticleListPage> {
  const profile = await getProfile(userId);
  const profileLevel = isDifficultyLevel(profile?.englishLevel) ? profile.englishLevel : null;
  const picks = await listScoredPicksPage(userId, {
    maxLevel: urlLevel ?? profileLevel,
    topics: parseTopics(profile?.topics),
    offset: page.offset,
    limit: page.limit,
  });
  return { articles: picks.articles, hasMore: picks.hasMore };
}

async function listBrowseArticles(
  categoryParam: string,
  urlLevel: EnglishLevel | null,
  pageRequest: PageRequest,
): Promise<ArticleListPage> {
  const category = parseCategoryParam(categoryParam);
  const page = await listCategoryPage(category, {
    offset: pageRequest.offset,
    limit: pageRequest.limit,
    maxLevel: urlLevel,
  });
  return { articles: page.articles.map(toListingArticle), hasMore: page.hasMore };
}

/**
 * Paginated listing feed for the browse homepage. Query params:
 *   - `view`     : "picks" for the personalized view (overrides `category`).
 *   - `category` : a category slug; omitted/`all` lists across all categories.
 *   - `level`    : CEFR level cap (e.g. "B1") — filters articles to at/below.
 *   - `offset`   : number of items to skip (incremental loading).
 *   - `limit`    : page size (default {@link BROWSE_PAGE_SIZE}).
 * Returns `{ articles, progress, hasMore, offset }`.
 */
export const GET = createHandler({ query: parseQuery }, async ({ query, session }) => {
  const { view, category: categoryParam, level: levelParam, offset, limit } = query;

  const urlLevel = parseLevelParam(levelParam);
  const page =
    view === "picks"
      ? await listPicksArticles(session.user.id, urlLevel, { offset, limit })
      : await listBrowseArticles(categoryParam, urlLevel, { offset, limit });

  return NextResponse.json(
    await buildArticleListResponse(session.user.id, page.articles, {
      offset,
      hasMore: page.hasMore,
    })
  );
});
