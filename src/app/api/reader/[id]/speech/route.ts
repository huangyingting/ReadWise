import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateArticleSpeech } from "@/lib/speech";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";

export const runtime = "nodejs";

export const POST = createHandler({ params: idParams }, async ({ params, session }) => {
  const { context } = await requireReadableArticleForAI(params.id, session.user);
  const result = await getOrCreateArticleSpeech(params.id, context);
  if (!result) {
    throw new ApiError(404, "Article not found");
  }
  return NextResponse.json(result);
});
