import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateArticleVocabulary } from "@/lib/vocabulary";

export const POST = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const result = await getOrCreateArticleVocabulary(params.id, session.user.id);
    if (!result) {
      throw new ApiError(404, "Article not found");
    }
    return NextResponse.json(result);
  },
);
