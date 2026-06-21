import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHandler, ApiError } from "@/lib/api-handler";
import { ENGLISH_LEVELS, type EnglishLevel, getProfile } from "@/lib/profile";
import { levelRank } from "@/lib/difficulty";
import {
  recommendLevelChange,
  type LevelingSignals,
} from "@/lib/leveling";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * GET /api/level-recommendation
 *
 * Returns a level-change recommendation based on the user's recent quiz scores
 * and reading completion. Does not modify any state — always requires explicit
 * user action to apply.
 *
 * Response 200:
 *   {
 *     suggestion: "up" | "down" | "hold",
 *     confidence: number,          // 0–1
 *     rationale: string,
 *     targetLevel: string | null,  // CEFR level or null when holding
 *     currentLevel: string,
 *   }
 *
 * Errors: 401 unauthenticated, 404 profile not found.
 */
export const GET = createHandler({}, async ({ session }) => {
  const userId = session.user.id;

  checkRateLimit(userId, "lookup");

  const profile = await getProfile(userId);
  if (!profile) {
    throw new ApiError(404, "Profile not found");
  }

  const currentLevel = profile.englishLevel as EnglishLevel;
  const currentRank = levelRank(currentLevel);

  // Run all three independent DB queries concurrently.
  const [recentAttempts, completedAtLevel, totalAtLevel] = await Promise.all([
    // Fetch recent quiz attempts for articles at-or-above the current level.
    // We limit to the last 20 attempts to stay recency-weighted.
    prisma.quizAttempt.findMany({
      where: {
        userId,
        article: {
          status: "published", ownerId: null,
          difficulty: {
            in: ENGLISH_LEVELS.slice(currentRank) as string[],
          },
        },
      },
      orderBy: { completedAt: "desc" },
      take: 20,
      select: { scorePct: true },
    }),

    // Count completed articles at exactly the current level.
    prisma.readingProgress.count({
      where: {
        userId,
        completed: true,
        article: {
          status: "published", ownerId: null,
          difficulty: currentLevel,
        },
      },
    }),

    prisma.article.count({
      where: { status: "published", difficulty: currentLevel, ownerId: null },
    }),
  ]);

  const avgQuizScore =
    recentAttempts.length > 0
      ? recentAttempts.reduce((sum, a) => sum + a.scorePct, 0) /
        recentAttempts.length
      : null;

  const signals: LevelingSignals = {
    avgQuizScore,
    quizAttemptCount: recentAttempts.length,
    completedAtLevel,
    totalAtLevel,
    currentLevel,
  };

  const recommendation = recommendLevelChange(signals);

  return NextResponse.json({ ...recommendation, currentLevel });
});
