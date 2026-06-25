import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateArticleQuiz } from "@/lib/quiz";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";

export const POST = createHandler({ params: idParams }, async ({ params, session }) => {
  const { context } = await requireReadableArticleForAI(params.id, session.user);
  const result = await getOrCreateArticleQuiz(params.id, context);
  if (!result) {
    throw new ApiError(404, "Article not found");
  }
  return NextResponse.json(result);
});
