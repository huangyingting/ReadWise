import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { getOrCreateTranslation, isSupportedLanguage } from "@/lib/translation";
import { getViewableArticleById } from "@/lib/articles";
import { checkRateLimit } from "@/lib/rate-limit";

const bodySchema = object({ lang: nonEmptyString(20) });

export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    await requireViewable(params.id, session.user.role);
    checkRateLimit(session.user.id, "ai");
    if (!isSupportedLanguage(body.lang)) {
      throw new ApiError(400, "Unsupported target language");
    }
    const result = await getOrCreateTranslation(params.id, body.lang);
    if (!result) {
      throw new ApiError(404, "Article not found");
    }
    return NextResponse.json(result);
  },
);

async function requireViewable(id: string, role?: string | null): Promise<void> {
  const article = await getViewableArticleById(id, role);
  if (!article) throw new ApiError(404, "Article not found");
}
