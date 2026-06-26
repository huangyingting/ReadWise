import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { getStreakSummary } from "@/lib/engagement";
import { getReviewSummary } from "@/lib/learning/flashcards";

/**
 * GET /api/gamification/summary
 *
 * Returns the authenticated user's streak stats, daily-goal progress, and
 * due-flashcard count in a single request so the dashboard can populate all
 * gamification widgets without multiple round trips.
 *
 * Response 200:
 *   {
 *     currentStreak: number,       // consecutive active days (today or yesterday anchor)
 *     longestStreak: number,       // all-time best streak
 *     dailyGoal: number,           // articles/day target from profile (default 2)
 *     todayProgress: number,       // distinct articles progressed today
 *     last7Days: { date: string (YYYY-MM-DD), active: boolean }[],
 *     dueCount: number             // flashcards due now
 *   }
 *
 * Errors: 401 if unauthenticated.
 */
export const GET = createHandler({}, async ({ session }) => {
  const userId = session.user.id;
  const [streak, { dueCount }] = await Promise.all([
    getStreakSummary(userId),
    getReviewSummary(userId),
  ]);
  return NextResponse.json({ ...streak, dueCount });
});
