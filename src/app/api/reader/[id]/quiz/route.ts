import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateArticleQuiz } from "@/lib/quiz";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";
import { levelQuery } from "@/lib/article-levels/http";

/** The article's quiz at the `?level=` reading level (#1303; absent = original). */
export const POST = createHandler({ params: idParams, query: levelQuery }, async ({ params, query, session }) => {
  const articleId = params.id;
  const { context } = await requireReadableArticleForAI(articleId, session.user);
  const result = await getOrCreateArticleQuiz(articleId, context, query.level);
  if (!result) {
    throw new ApiError(404, "Article not found");
  }
  return NextResponse.json(result);
});
