import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, nonEmptyString } from "@/lib/validation";
import { getOrCreateTranslation, isSupportedLanguage } from "@/lib/translation";

const bodySchema = object({ lang: nonEmptyString(20) });

export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body }) => {
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
