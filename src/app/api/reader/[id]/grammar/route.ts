import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, nonEmptyString, optional, string } from "@/lib/validation";
import { explainGrammar, MAX_PHRASE_CHARS, MAX_CONTEXT_CHARS } from "@/lib/grammar";
import { getViewableArticleById } from "@/lib/articles";

const bodySchema = object({
  phrase: nonEmptyString(MAX_PHRASE_CHARS),
  contextSentence: optional(string({ max: MAX_CONTEXT_CHARS })),
});

export const POST = createHandler(
  { params: idParams, body: bodySchema },
  async ({ params, body, session }) => {
    const article = await getViewableArticleById(params.id, session.user.role);
    if (!article) throw new ApiError(404, "Article not found");

    const result = await explainGrammar(
      params.id,
      body.phrase,
      body.contextSentence ?? "",
      article.difficulty ?? "B1",
    );

    return NextResponse.json(result);
  },
);
