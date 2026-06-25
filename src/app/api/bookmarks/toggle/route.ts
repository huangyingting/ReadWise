import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { throwIfFailed } from "@/lib/result";
import { toggleBookmark } from "@/lib/article-library";
import { toggleBookmarkBody } from "@/lib/article-library/collections/schemas";

/**
 * POST /api/bookmarks/toggle — toggles the article in the user's default
 * "Saved" list. Returns `{bookmarked: true}` when added, `{bookmarked: false}`
 * when removed. 404 if the article does not exist.
 */
export const POST = createHandler({ body: toggleBookmarkBody }, async ({ body, session }) => {
  const result = await toggleBookmark(session.user.id, body.articleId, session.user.role);
  throwIfFailed(result);
  return NextResponse.json({ bookmarked: result.bookmarked });
});
