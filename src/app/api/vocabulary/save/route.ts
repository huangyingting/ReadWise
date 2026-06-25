import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { saveWord } from "@/lib/lexical/saved-words";
import { recordWordExposure } from "@/lib/learning/word-mastery";
import { bestEffortMastery } from "@/lib/learning/primitives";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import { saveWordBody } from "@/lib/vocabulary/schemas";

export const POST = createHandler({ body: saveWordBody }, async ({ body, session }) => {
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
