import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { addToList } from "@/lib/bookmarks";

const bodySchema = object({ articleId: nonEmptyString(200) });

/** POST /api/lists/[id]/items — adds an article to a list (idempotent). */
export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    const result = await addToList(params.id, session.user.id, body.articleId);
    if (!result.ok) throw new ApiError(result.status, result.error);
    return NextResponse.json({ ok: true });
  },
);
