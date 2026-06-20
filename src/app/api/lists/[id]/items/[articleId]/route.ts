import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { removeFromList } from "@/lib/bookmarks";

/** Validates both the list id and the article id from the URL path. */
const itemParams = object({
  id: nonEmptyString(200),
  articleId: nonEmptyString(200),
});

/** DELETE /api/lists/[id]/items/[articleId] — removes an article from a list. */
export const DELETE = createHandler(
  { params: itemParams },
  async ({ params, session }) => {
    const result = await removeFromList(params.id, session.user.id, params.articleId);
    if (!result.ok) throw new ApiError(result.status, result.error);
    return NextResponse.json({ ok: true });
  },
);
