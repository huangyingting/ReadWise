import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { getDueFlashcards, getReviewSummary } from "@/lib/learning/flashcards";

type FlashcardsPayload = {
  cards: Awaited<ReturnType<typeof getDueFlashcards>>;
  dueCount: Awaited<ReturnType<typeof getReviewSummary>>["dueCount"];
};

async function getFlashcardsPayload(userId: string): Promise<FlashcardsPayload> {
  const [cards, { dueCount }] = await Promise.all([
    getDueFlashcards(userId),
    getReviewSummary(userId),
  ]);
  return { cards, dueCount };
}

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
  return NextResponse.json(await getFlashcardsPayload(session.user.id));
});
