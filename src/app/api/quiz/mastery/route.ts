import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { getQuizMastery } from "@/lib/quiz-mastery";

/**
 * GET /api/quiz/mastery
 *
 * Returns overall comprehension mastery stats for the authenticated user.
 * Scoped entirely to the calling user — no IDOR possible.
 *
 * Response 200: {
 *   totalAttempts: number,
 *   articlesQuizzed: number,           // distinct articles attempted
 *   averageScore: number | null,        // null when no attempts yet
 *   recentTrend: [{ completedAt, scorePct }], // last ≤10 attempts, oldest→newest
 * }
 * Errors: 401 unauthenticated
 */
export const GET = createHandler({}, async ({ session }) => {
  const mastery = await getQuizMastery(session.user.id);
  return NextResponse.json(mastery);
});
