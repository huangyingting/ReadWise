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

type ItemParams = {
  id: string;
  articleId: string;
};

const DELETE_SUCCESS = { ok: true } as const;

async function removeOwnedListItem(params: ItemParams, userId: string): Promise<void> {
  const result = await removeFromList(params.id, userId, params.articleId);
  throwIfFailed(result);
}

/** DELETE /api/lists/[id]/items/[articleId] — removes an article from a list. */
export const DELETE = createHandler(
  { params: itemParams },
  async ({ params, session }) => {
    await removeOwnedListItem(params, session.user.id);
    return NextResponse.json(DELETE_SUCCESS);
  },
);
