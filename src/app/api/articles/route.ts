import { NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/api-auth";
import {
  BROWSE_PAGE_SIZE,
  listCategoryPage,
  listPicksPage,
  toListingArticle,
} from "@/lib/articles";
import { getProgressSummaries } from "@/lib/progress";
import { getProfile, parseTopics } from "@/lib/profile";
import { isValidCategorySlug } from "@/lib/categories";
import { isDifficultyLevel } from "@/lib/difficulty";

const MAX_LIMIT = 24;

/**
 * Paginated listing feed for the browse homepage. Query params:
 *   - `view`     : "picks" for the personalized view (overrides `category`).
 *   - `category` : a category slug; omitted/`all` lists across all categories.
 *   - `offset`   : number of items to skip (incremental loading).
 *   - `limit`    : page size (default {@link BROWSE_PAGE_SIZE}).
 * Returns `{ articles, progress, hasMore, offset }`.
 */
export async function GET(req: Request) {
  const { session, error } = await requireSessionApi();
  if (error) {
    return error;
  }

  const url = new URL(req.url);
  const view = url.searchParams.get("view");
  const categoryParam = url.searchParams.get("category");
  const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Math.min(MAX_LIMIT, Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : BROWSE_PAGE_SIZE);

  let page;
  if (view === "picks") {
    const profile = await getProfile(session.user.id);
    const level = isDifficultyLevel(profile?.englishLevel) ? profile.englishLevel : null;
    const topics = parseTopics(profile?.topics);
    page = await listPicksPage(level, topics, { offset, limit });
  } else {
    const category =
      categoryParam && categoryParam !== "all" && isValidCategorySlug(categoryParam)
        ? categoryParam
        : null;
    page = await listCategoryPage(category, { offset, limit });
  }

  const progress = await getProgressSummaries(
    session.user.id,
    page.articles.map((a) => a.id),
  );

  return NextResponse.json({
    articles: page.articles.map(toListingArticle),
    progress,
    hasMore: page.hasMore,
    offset: offset + page.articles.length,
  });
}
