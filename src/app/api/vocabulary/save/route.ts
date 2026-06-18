import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, nonEmptyString, optional, string } from "@/lib/validation";
import { saveWord } from "@/lib/vocabulary";

const bodySchema = object({
  word: nonEmptyString(200),
  explanation: optional(string({ trim: false, max: 5000 })),
  example: optional(string({ trim: false, max: 5000 })),
  articleId: optional(nonEmptyString(200)),
});

export const POST = createHandler({ body: bodySchema }, async ({ body, session }) => {
  await saveWord(session.user.id, {
    word: body.word,
    explanation: body.explanation ?? null,
    example: body.example ?? null,
    articleId: body.articleId ?? null,
  });
  return NextResponse.json({ word: body.word, saved: true });
});
