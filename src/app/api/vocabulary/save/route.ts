import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, nonEmptyString, optional, string } from "@/lib/validation";
import { saveWord } from "@/lib/vocabulary";
import { recordWordExposure } from "@/lib/word-mastery";
import { bestEffortMastery } from "@/lib/mastery";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics";

const bodySchema = object({
  word: nonEmptyString(200),
  explanation: optional(string({ trim: false, max: 5000 })),
  example: optional(string({ trim: false, max: 5000 })),
  contextSentence: optional(string({ trim: false, max: 2000 })),
  articleId: optional(nonEmptyString(200)),
});

export const POST = createHandler({ body: bodySchema }, async ({ body, session }) => {
  await saveWord(session.user.id, {
    word: body.word,
    explanation: body.explanation ?? null,
    example: body.example ?? null,
    contextSentence: body.contextSentence ?? null,
    articleId: body.articleId ?? null,
  });
  // Best-effort: an explicit save is a deliberate word exposure.
  await bestEffortMastery("vocabulary.save.exposure", () =>
    recordWordExposure(session.user.id, body.word, {
      articleId: body.articleId ?? undefined,
    }),
  );
  // Product analytics (RW-051): saving a word is a key activation signal.
  // Metadata only — the saved word and its explanation are NEVER stored.
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.saveWord,
    userId: session.user.id,
    articleId: body.articleId ?? null,
    properties: { hasArticle: Boolean(body.articleId) },
  });
  return NextResponse.json({ word: body.word, saved: true });
});
