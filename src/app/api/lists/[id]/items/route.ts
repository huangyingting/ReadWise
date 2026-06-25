import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { throwIfFailed } from "@/lib/result";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { addToList } from "@/lib/article-library";

const bodySchema = object({ articleId: nonEmptyString(200) });

/** POST /api/lists/[id]/items — adds an article to a list (idempotent). */
export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    const result = await addToList(params.id, session.user.id, body.articleId, session.user.role);
    throwIfFailed(result);
    return NextResponse.json({ ok: true });
  },
);
