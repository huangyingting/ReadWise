import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { getFilteredSavedWords, getArticleTitlesForWords, WORDS_PAGE_SIZE } from "@/lib/lexical/saved-words";
import { articleAccessContextForUser } from "@/lib/article-library";
import { parseWordsQuery } from "@/lib/study/schemas";

type FilteredSavedWords = Awaited<ReturnType<typeof getFilteredSavedWords>>;

function articleIdsForWords(words: FilteredSavedWords["words"]) {
  return [
    ...new Set(words.map((word) => word.articleId).filter(Boolean) as string[]),
  ];
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
export const GET = createHandler({ query: parseWordsQuery }, async ({ session, query }) => {
  const userId = session.user.id;
  const context = await articleAccessContextForUser(session.user);
  const result = await getFilteredSavedWords(userId, {
    search: query.q || undefined,
    articleId: query.articleId || undefined,
    filter: query.filter,
    page: query.page,
  });

  // Resolve article titles for words that have an articleId.
  const articleIds = articleIdsForWords(result.words);
  const articles = await getArticleTitlesForWords(articleIds, context);

  return NextResponse.json({
    words: result.words,
    articles,
    total: result.total,
    page: result.page,
    totalPages: result.totalPages,
    pageSize: WORDS_PAGE_SIZE,
  });
});
