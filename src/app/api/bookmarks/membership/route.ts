import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { queryString } from "@/lib/validation";
import { getArticleListMembership } from "@/lib/bookmarks";

function parseQuery(params: URLSearchParams) {
  const articleId = queryString(params, "articleId");
  if (!articleId) return { ok: false as const, error: "articleId is required" };
  return { ok: true as const, value: { articleId } };
}

/**
 * GET /api/bookmarks/membership?articleId=<id>
 *
 * Returns all of the user's lists annotated with whether the article is in
 * each list. Intended for the list-picker popover so the UI can render
 * checkbox state in one request.
 *
 * Response: `{ lists: {id, name, isDefault, hasArticle}[] }`
 */
export const GET = createHandler({ query: parseQuery }, async ({ query, session }) => {
  const result = await getArticleListMembership(session.user.id, query.articleId, session.user.role);
  if (result === null) {
    throw new ApiError(404, "Article not found");
  }
  return NextResponse.json({ lists: result });
});
