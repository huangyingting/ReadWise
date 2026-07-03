import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateArticleTags } from "@/lib/article-library";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";

export const POST = createHandler({ params: idParams }, async ({ params, session }) => {
  const articleId = params.id;
  const { context } = await requireReadableArticleForAI(articleId, session.user);
  const result = await getOrCreateArticleTags(articleId, context);
  if (!result) {
    throw new ApiError(404, "Article not found");
  }
  return NextResponse.json(result);
});
