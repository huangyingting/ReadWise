import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { toggleBookmark } from "@/lib/bookmarks";

const bodySchema = object({ articleId: nonEmptyString(200) });

/**
 * POST /api/bookmarks/toggle — toggles the article in the user's default
 * "Saved" list. Returns `{bookmarked: true}` when added, `{bookmarked: false}`
 * when removed. 404 if the article does not exist.
 */
export const POST = createHandler({ body: bodySchema }, async ({ body, session }) => {
  const result = await toggleBookmark(session.user.id, body.articleId);
  if (!result.ok) throw new ApiError(result.status, result.error);
  return NextResponse.json({ bookmarked: result.bookmarked });
});
