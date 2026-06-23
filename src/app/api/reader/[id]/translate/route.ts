import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { getOrCreateTranslation, isSupportedLanguage } from "@/lib/translation";
import { articleAccessContext, getReadableArticleById } from "@/lib/article-access";
import { checkRateLimit } from "@/lib/rate-limit";

const bodySchema = object({ lang: nonEmptyString(20) });

export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    const context = articleAccessContext(session.user);
    await requireViewable(params.id, context);
    await checkRateLimit(session.user.id, "ai");
    if (!isSupportedLanguage(body.lang)) {
      throw new ApiError(400, "Unsupported target language");
    }
    const result = await getOrCreateTranslation(params.id, body.lang, context);
    if (!result) {
      throw new ApiError(404, "Article not found");
    }
    return NextResponse.json(result);
  },
);

async function requireViewable(
  id: string,
  context: ReturnType<typeof articleAccessContext>,
): Promise<void> {
  const article = await getReadableArticleById(id, context);
  if (!article) throw new ApiError(404, "Article not found");
}
