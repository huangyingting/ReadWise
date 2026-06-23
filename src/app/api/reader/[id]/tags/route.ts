import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateArticleTags } from "@/lib/tags";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";
import { checkRateLimit } from "@/lib/rate-limit";

export const POST = createHandler({ params: idParams }, async ({ params, session }) => {
  const context = articleAccessContext(session.user);
  const article = await getReadableArticleById(params.id, context);
  if (!article) throw new ApiError(404, "Article not found");
  checkRateLimit(session.user.id, "ai");
  const result = await getOrCreateArticleTags(params.id, context);
  if (!result) {
    throw new ApiError(404, "Article not found");
  }
  return NextResponse.json(result);
});
