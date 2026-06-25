/**
 * POST /api/saved — batch bookmark-state check for listing pages.
 *
 * Accepts an array of article ids and returns which of them the authenticated
 * user has bookmarked in ANY of their reading lists. Used by
 * ListingBookmarkSync to refresh the saved indicator on listing cards after
 * the user bookmarks/unbookmarks articles in the reader and navigates back.
 *
 * Body:  { ids: string[] }
 * Response: { bookmarked: string[] }  — subset of input ids that are saved
 */
import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, array, nonEmptyString } from "@/lib/validation";
import { getBookmarkedArticleIds } from "@/lib/article-library";

const bodySchema = object({ ids: array(nonEmptyString(200), { max: 200 }) });

export const POST = createHandler({ body: bodySchema }, async ({ session, body }) => {
  const bookmarked = await getBookmarkedArticleIds(session.user.id, body.ids);
  return NextResponse.json({ bookmarked: [...bookmarked] });
});
