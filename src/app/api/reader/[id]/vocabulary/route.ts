import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateArticleVocabulary } from "@/lib/vocabulary";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";

export const POST = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const { context } = await requireReadableArticleForAI(params.id, session.user);
    const result = await getOrCreateArticleVocabulary(params.id, session.user.id, context);
    if (!result) {
      throw new ApiError(404, "Article not found");
    }
    return NextResponse.json(result);
  },
);
