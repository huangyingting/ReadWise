import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateArticleSpeech } from "@/lib/speech";

export const runtime = "nodejs";

export const POST = createHandler({ params: idParams }, async ({ params }) => {
  const result = await getOrCreateArticleSpeech(params.id);
  if (!result) {
    throw new ApiError(404, "Article not found");
  }
  return NextResponse.json(result);
});
