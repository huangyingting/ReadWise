import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { queryInt, queryString } from "@/lib/validation";
import { getFilteredSavedWords, WORDS_PAGE_SIZE } from "@/lib/vocabulary";
import { prisma } from "@/lib/prisma";
import { articleAccessContext, readableArticleWhere } from "@/lib/article-access";

function parseQuery(params: URLSearchParams) {
  const filter = queryString(params, "filter", "all");
  if (filter !== "all" && filter !== "due" && filter !== "new") {
    return { ok: false as const, error: 'filter must be "all", "due", or "new"' };
  }
  return {
    ok: true as const,
    value: {
      q: queryString(params, "q", ""),
      articleId: queryString(params, "articleId", ""),
      filter: filter as "all" | "due" | "new",
      page: queryInt(params, "page", { fallback: 1, min: 1, max: 9999 }),
    },
  };
}

/**
 * GET /api/study/words
 *
 * Returns a paginated, searchable list of the user's saved words plus
 * the article title for linkback (when the article still exists).
 *
 * Query params:
 *   q          - search term (matches word or explanation)
 *   articleId  - filter to a specific source article
 *   filter     - "all" | "due" | "new" (SRS filter)
 *   page       - 1-based page (default 1)
 *
 * Response 200:
 *   {
 *     words: SavedWordView[],
 *     articles: Record<string, string>,   // articleId → title
 *     total: number,
 *     page: number,
 *     totalPages: number,
 *     pageSize: number,
 *   }
 */
export const GET = createHandler({ query: parseQuery }, async ({ session, query }) => {
  const userId = session.user.id;
  const context = articleAccessContext(session.user);
  const result = await getFilteredSavedWords(userId, {
    search: query.q || undefined,
    articleId: query.articleId || undefined,
    filter: query.filter,
    page: query.page,
  });

  // Resolve article titles for words that have an articleId
  const articleIds = [
    ...new Set(result.words.map((w) => w.articleId).filter(Boolean) as string[]),
  ];
  const articles: Record<string, string> = {};
  if (articleIds.length > 0) {
    const rows = await prisma.article.findMany({
      where: readableArticleWhere(context, { id: { in: articleIds } }),
      select: { id: true, title: true },
    });
    for (const row of rows) {
      articles[row.id] = row.title;
    }
  }

  return NextResponse.json({
    words: result.words,
    articles,
    total: result.total,
    page: result.page,
    totalPages: result.totalPages,
    pageSize: WORDS_PAGE_SIZE,
  });
});
