import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { queryString, queryInt } from "@/lib/validation";
import {
  BROWSE_PAGE_SIZE,
  listCategoryPage,
  toListingArticle,
  type ListingArticle,
} from "@/lib/articles";
import { listScoredPicksPage } from "@/lib/recommendations";
import { getProgressSummaries } from "@/lib/progress";
import { getProfile, parseTopics, ENGLISH_LEVELS } from "@/lib/profile";
import { isValidCategorySlug } from "@/lib/categories";
import { isDifficultyLevel } from "@/lib/difficulty";

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

  // Validate the level param against known CEFR levels.
  const urlLevel =
    levelParam && (ENGLISH_LEVELS as readonly string[]).includes(levelParam)
      ? (levelParam as (typeof ENGLISH_LEVELS)[number])
      : null;

  let articles: ListingArticle[];
  let hasMore: boolean;
  if (view === "picks") {
    const profile = await getProfile(session.user.id);
    const profileLevel = isDifficultyLevel(profile?.englishLevel) ? profile.englishLevel : null;
    const maxLevel = urlLevel ?? profileLevel;
    const topics = parseTopics(profile?.topics);
    const picks = await listScoredPicksPage(session.user.id, {
      maxLevel,
      topics,
      offset,
      limit,
    });
    articles = picks.articles;
    hasMore = picks.hasMore;
  } else {
    const category =
      categoryParam && categoryParam !== "all" && isValidCategorySlug(categoryParam)
        ? categoryParam
        : null;
    const page = await listCategoryPage(category, { offset, limit, maxLevel: urlLevel });
    articles = page.articles.map(toListingArticle);
    hasMore = page.hasMore;
  }

  const progress = await getProgressSummaries(
    session.user.id,
    articles.map((a) => a.id),
  );

  return NextResponse.json({
    articles,
    progress,
    hasMore,
    offset: offset + articles.length,
  });
});
