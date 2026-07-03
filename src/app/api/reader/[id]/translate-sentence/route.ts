import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { isSupportedLanguage } from "@/lib/translation";
import { translateSentence } from "@/lib/sentence-translation";
import { requireReadableArticleForAI } from "@/lib/reader/route-guard";
import { translateSentenceBody } from "@/lib/reader/schemas";

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
  { params: idParams, body: translateSentenceBody },
  async ({ params, body, session }) => {
    const { context } = await requireReadableArticleForAI(params.id, session.user);
    assertSupportedTargetLanguage(body.lang);
    const result = await translateSentence(params.id, body.text, body.lang, context);
    return NextResponse.json(requireTranslationResult(result));
  },
);
