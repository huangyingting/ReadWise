import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateArticleTags } from "@/lib/tags";
import { getViewableArticleById } from "@/lib/articles";
import { checkRateLimit } from "@/lib/rate-limit";

export const POST = createHandler({ params: idParams }, async ({ params, session }) => {
  const article = await getViewableArticleById(params.id, session.user.role);
  if (!article) throw new ApiError(404, "Article not found");
  checkRateLimit(session.user.id, "ai");
  const result = await getOrCreateArticleTags(params.id);
  if (!result) {
    throw new ApiError(404, "Article not found");
  }
  return NextResponse.json(result);
});
