import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { getOrCreateTranslation, isSupportedLanguage } from "@/lib/translation";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";
import { translateBody } from "@/lib/reader/schemas";

const UNSUPPORTED_LANGUAGE_ERROR = "Unsupported target language";
const ARTICLE_NOT_FOUND_ERROR = "Article not found";

function assertSupportedTargetLanguage(lang: string): void {
  if (!isSupportedLanguage(lang)) {
    throw new ApiError(400, UNSUPPORTED_LANGUAGE_ERROR);
  }
}

function requireTranslationResult<T>(result: T | null): T {
  if (!result) {
    throw new ApiError(404, ARTICLE_NOT_FOUND_ERROR);
  }
  return result;
}

export const POST = createHandler(
  { params: idParams, body: translateBody },
  async ({ params, body, session }) => {
    const { context } = await requireReadableArticleForAI(params.id, session.user);
    assertSupportedTargetLanguage(body.lang);
    const result = await getOrCreateTranslation(params.id, body.lang, context);
    return NextResponse.json(requireTranslationResult(result));
  },
);
