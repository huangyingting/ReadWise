import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { isSupportedLanguage } from "@/lib/translation";
import { translateSentence, MAX_SENTENCE_CHARS } from "@/lib/sentence-translation";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";
import { checkRateLimit } from "@/lib/rate-limit";

const bodySchema = object({
  text: nonEmptyString(MAX_SENTENCE_CHARS),
  lang: nonEmptyString(20),
});

export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    const context = articleAccessContext(session.user);
    const article = await getReadableArticleById(params.id, context);
    if (!article) throw new ApiError(404, "Article not found");
    await checkRateLimit(session.user.id, "ai");
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
