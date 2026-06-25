import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { getDueFlashcards } from "@/lib/flashcards";
import { buildCloze } from "@/lib/cloze";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseClozeQuery } from "@/lib/study/schemas";

/**
 * GET /api/study/cloze
 *
 * Returns cloze items for cards that are due for review.
 * Cards without an example sentence, or where the word cannot be located in
 * the example, are returned in definition-mode (cloze=null) so the client
 * gracefully falls back.
 *
 * Query params:
 *   - `limit`: number of cards to return (default 20, max 50)
 *
 * Response 200:
 *   {
 *     items: Array<{
 *       id: string,
 *       word: string,
 *       explanation: string | null,
 *       example: string | null,
 *       cloze: { masked: string, answerLength: number } | null
 *     }>
 *   }
 *
 * Errors: 401 unauthenticated.
 */
export const GET = createHandler({ query: parseClozeQuery }, async ({ session, query }) => {
  await checkRateLimit(session.user.id, "lookup");

  const cards = await getDueFlashcards(session.user.id, query.limit);

  const items = cards.map((card) => {
    const result =
      card.example ? buildCloze(card.word, card.example) : null;

    return {
      id: card.id,
      word: card.word,
      explanation: card.explanation,
      example: card.example,
      contextSentence: card.contextSentence,
      articleId: card.articleId,
      cloze:
        result?.ok
          ? { masked: result.card.masked, answerLength: result.card.answerLength }
          : null,
    };
  });

  return NextResponse.json({ items });
});
