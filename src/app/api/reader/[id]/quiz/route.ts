import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateArticleQuiz } from "@/lib/quiz";
import { getViewableArticleById } from "@/lib/articles";
import { checkRateLimit } from "@/lib/rate-limit";

export const POST = createHandler({ params: idParams }, async ({ params, session }) => {
  const article = await getViewableArticleById(params.id, session.user.role, session.user.id);
  if (!article) throw new ApiError(404, "Article not found");
  checkRateLimit(session.user.id, "ai");
  const result = await getOrCreateArticleQuiz(params.id);
  if (!result) {
    throw new ApiError(404, "Article not found");
  }
  return NextResponse.json(result);
});
