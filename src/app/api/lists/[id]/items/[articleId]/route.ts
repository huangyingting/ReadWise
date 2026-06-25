import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { throwIfFailed } from "@/lib/result";
import { object, nonEmptyString } from "@/lib/validation";
import { removeFromList } from "@/lib/article-library";

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
    throwIfFailed(result);
    return NextResponse.json({ ok: true });
  },
);
