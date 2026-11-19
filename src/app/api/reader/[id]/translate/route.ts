import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateTranslation } from "@/lib/translation";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";
import { requireSupportedTargetLanguage, requireTranslationResult } from "@/lib/reader/translation-http";
import { translateBody } from "@/lib/reader/schemas";

export const POST = createHandler(
  { params: idParams, body: translateBody },
  async ({ params, body, session }) => {
    const { context } = await requireReadableArticleForAI(params.id, session.user);
    requireSupportedTargetLanguage(body.lang);
    const result = await getOrCreateTranslation(params.id, body.lang, context);
    return NextResponse.json(requireTranslationResult(result));
  },
);
