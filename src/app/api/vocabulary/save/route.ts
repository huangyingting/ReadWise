import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { saveWord } from "@/lib/lexical/saved-words";
import { recordWordExposure } from "@/lib/learning/word-mastery";
import { bestEffortMastery } from "@/lib/learning/primitives";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import { saveWordBody, type SaveWordBody } from "@/lib/vocabulary/schemas";

function savedWordInput(body: SaveWordBody) {
  return {
    word: body.word,
    explanation: body.explanation ?? null,
    example: body.example ?? null,
    contextSentence: body.contextSentence ?? null,
    articleId: body.articleId ?? null,
  };
}

function exposureContext(body: SaveWordBody) {
  return {
    articleId: body.articleId ?? undefined,
  };
}

function saveWordAnalyticsProperties(body: SaveWordBody) {
  return { hasArticle: Boolean(body.articleId) };
}

export const POST = createHandler({ body: saveWordBody }, async ({ body, session }) => {
  const userId = session.user.id;

  await saveWord(userId, savedWordInput(body));
  // Best-effort: an explicit save is a deliberate word exposure.
  await bestEffortMastery("vocabulary.save.exposure", () =>
    recordWordExposure(userId, body.word, exposureContext(body)),
  );
  // Product analytics (RW-051): saving a word is a key activation signal.
  // Metadata only — the saved word and its explanation are NEVER stored.
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.saveWord,
    userId,
    articleId: body.articleId ?? null,
    properties: saveWordAnalyticsProperties(body),
  });
  return NextResponse.json({ word: body.word, saved: true });
});
