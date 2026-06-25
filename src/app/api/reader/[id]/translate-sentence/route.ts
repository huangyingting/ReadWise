import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { isSupportedLanguage } from "@/lib/translation";
import { translateSentence } from "@/lib/sentence-translation";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";
import { translateSentenceBody } from "@/lib/reader/schemas";

export const POST = createHandler(
  { params: idParams, body: translateSentenceBody },
  async ({ params, body, session }) => {
    const { context } = await requireReadableArticleForAI(params.id, session.user);
    if (!isSupportedLanguage(body.lang)) {
      throw new ApiError(400, "Unsupported target language");
    }
    const result = await translateSentence(params.id, body.text, body.lang, context);
    if (!result) {
      throw new ApiError(404, "Article not found");
    }
    return NextResponse.json(result);
  },
);
