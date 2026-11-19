import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { translateSentence } from "@/lib/sentence-translation";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";
import { requireSupportedTargetLanguage, requireTranslationResult } from "@/lib/reader/translation-http";
import { translateSentenceBody } from "@/lib/reader/schemas";

export const POST = createHandler(
  { params: idParams, body: translateSentenceBody },
  async ({ params, body, session }) => {
    const { context } = await requireReadableArticleForAI(params.id, session.user);
    requireSupportedTargetLanguage(body.lang);
    const result = await translateSentence(params.id, body.text, body.lang, context);
    return NextResponse.json(requireTranslationResult(result));
  },
);
