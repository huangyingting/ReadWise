import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { getAdaptiveLevelRecommendation } from "@/lib/leveling";
import {
  enforceRateLimitPolicy,
  sessionUserRateLimitPolicy,
} from "@/lib/security/rate-limit/index";

const LEVEL_RECOMMENDATION_RATE_LIMIT = sessionUserRateLimitPolicy("lookup");

type LevelRecommendation = NonNullable<
  Awaited<ReturnType<typeof getAdaptiveLevelRecommendation>>
>;

async function getRecommendationOrThrow(userId: string): Promise<LevelRecommendation> {
  const recommendation = await getAdaptiveLevelRecommendation(userId);
  if (!recommendation) {
    throw new ApiError(404, "Profile not found");
  }

  return recommendation;
}

function toLevelRecommendationPayload(recommendation: LevelRecommendation) {
  return {
    suggestion: recommendation.suggestion,
    confidence: recommendation.confidence,
    rationale: recommendation.explanation.join(" "),
    explanation: recommendation.explanation,
    targetLevel: recommendation.targetLevel,
    recommendedLevel: recommendation.recommendedLevel,
    currentLevel: recommendation.currentLevel,
  };
}

/**
 * GET /api/level-recommendation
 *
 * Returns an evidence-based CEFR level recommendation (RW-040) combining the
 * user's recent quiz performance, per-article difficulty feedback
 * (too_easy/too_hard) and SkillMastery confidence. Does not modify any state —
 * applying a change always remains an explicit user action (the banner PUTs
 * /api/profile, which records the change in LevelHistory).
 *
 * Response 200:
 *   {
 *     suggestion: "up" | "down" | "hold",
 *     confidence: number,          // 0–1
 *     rationale: string,           // explanation joined into one sentence
 *     explanation: string[],       // individual evidence reasons
 *     targetLevel: string | null,  // CEFR level or null when holding
 *     recommendedLevel: string,    // engine-target level (may differ from profile)
 *     currentLevel: string,
 *   }
 *
 * Errors: 401 unauthenticated, 404 profile not found.
 */
export const GET = createHandler({}, async ({ session }) => {
  await enforceRateLimitPolicy(LEVEL_RECOMMENDATION_RATE_LIMIT, { session });
  const recommendation = await getRecommendationOrThrow(session.user.id);
  return NextResponse.json(toLevelRecommendationPayload(recommendation));
});
