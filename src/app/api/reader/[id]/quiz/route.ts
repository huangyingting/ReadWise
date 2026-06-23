import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateArticleQuiz } from "@/lib/quiz";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";
import { checkRateLimit } from "@/lib/rate-limit";

export const POST = createHandler({ params: idParams }, async ({ params, session }) => {
  const context = articleAccessContext(session.user);
  const article = await getReadableArticleById(params.id, context);
  if (!article) throw new ApiError(404, "Article not found");
  await checkRateLimit(session.user.id, "ai");
  const result = await getOrCreateArticleQuiz(params.id, context);
  if (!result) {
    throw new ApiError(404, "Article not found");
  }
  return NextResponse.json(result);
});
