import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { isSupportedLanguage } from "@/lib/translation";
import { translateSentence, MAX_SENTENCE_CHARS } from "@/lib/sentence-translation";
import { getViewableArticleById } from "@/lib/articles";
import { checkRateLimit } from "@/lib/rate-limit";

const bodySchema = object({
  text: nonEmptyString(MAX_SENTENCE_CHARS),
  lang: nonEmptyString(20),
});

export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    const article = await getViewableArticleById(params.id, session.user.role);
    if (!article) throw new ApiError(404, "Article not found");
    checkRateLimit(session.user.id, "ai");
    if (!isSupportedLanguage(body.lang)) {
      throw new ApiError(400, "Unsupported target language");
    }
    const result = await translateSentence(params.id, body.text, body.lang);
    if (!result) {
      throw new ApiError(404, "Article not found");
    }
    return NextResponse.json(result);
  },
);
