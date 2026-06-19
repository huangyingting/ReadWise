import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { getDueFlashcards, getReviewSummary } from "@/lib/flashcards";

/**
 * GET /api/study/flashcards
 *
 * Returns cards due for review and the total due count.
 * Cards with dueAt=null (never reviewed) appear before past-due cards.
 *
 * Response 200:
 *   {
 *     cards: { id: string, word: string, explanation: string|null, example: string|null }[],
 *     dueCount: number   // total due (may exceed cards.length if > default limit)
 *   }
 *
 * Errors: 401 if unauthenticated.
 */
export const GET = createHandler({}, async ({ session }) => {
  const userId = session.user.id;
  const [cards, { dueCount }] = await Promise.all([
    getDueFlashcards(userId),
    getReviewSummary(userId),
  ]);
  return NextResponse.json({ cards, dueCount });
});
