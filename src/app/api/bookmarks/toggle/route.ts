import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { toggleBookmark } from "@/lib/bookmarks";
import { toggleBookmarkBody } from "@/lib/bookmarks/schemas";

/**
 * POST /api/bookmarks/toggle — toggles the article in the user's default
 * "Saved" list. Returns `{bookmarked: true}` when added, `{bookmarked: false}`
 * when removed. 404 if the article does not exist.
 */
export const POST = createHandler({ body: toggleBookmarkBody }, async ({ body, session }) => {
  const result = await toggleBookmark(session.user.id, body.articleId, session.user.role);
  if (!result.ok) throw new ApiError(result.status, result.error);
  return NextResponse.json({ bookmarked: result.bookmarked });
});
