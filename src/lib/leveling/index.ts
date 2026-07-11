/**
 * Adaptive CEFR level progression — #37 + RW-040.
 *
 * Public barrel. Implementation split by concern:
 *   types   — shared types and constants (pure, no I/O)
 *   engine  — pure recommendation functions: {@link recommendLevelChange},
 *             {@link computeAdaptiveLevel}, {@link difficultyBiasFromFeedback}
 *   cefr-primitives — rank/range utilities (pure, client-safe)
 *
 * DB-backed readers ({@link getLevelEvidence}, {@link getAdaptiveLevelRecommendation})
 * live in this file so the pure engine remains Prisma-free.
 *
 * Contract note: this module owns shared CEFR level/rank primitives consumed by
 * difficulty and recommendations.
 */

import { prisma } from "@/lib/prisma";
import { ENGLISH_LEVELS } from "@/lib/option-registries";
import { getProfile } from "@/lib/profile";
import { getSkillProfile } from "@/lib/learning/skill-mastery";
import { publicListableArticleWhere } from "@/lib/article-library";
import { computeAdaptiveLevel } from "./engine";
import type { LevelEvidence, FeedbackCounts, AdaptiveLevelRecommendation } from "./types";

export * from "./types";
export * from "./engine";
export * from "./cefr-primitives";

type FeedbackGroupRow = { vote: string; _count: { _all: number } };

const FEEDBACK_VOTES = ["too_easy", "just_right", "too_hard"] as const;

function normalizeEnglishLevel(level: string): (typeof ENGLISH_LEVELS)[number] {
  return (ENGLISH_LEVELS as readonly string[]).includes(level)
    ? (level as (typeof ENGLISH_LEVELS)[number])
    : ENGLISH_LEVELS[0];
}

function emptyFeedbackCounts(): FeedbackCounts {
  return { too_easy: 0, just_right: 0, too_hard: 0 };
}

function isFeedbackVote(vote: string): vote is keyof FeedbackCounts {
  return (FEEDBACK_VOTES as readonly string[]).includes(vote);
}

function feedbackCountsFromRows(rows: FeedbackGroupRow[]): FeedbackCounts {
  const feedback = emptyFeedbackCounts();
  for (const row of rows) {
    if (isFeedbackVote(row.vote)) {
      feedback[row.vote] = row._count._all;
    }
  }
  return feedback;
}

function averageQuizScore(attempts: Array<{ scorePct: number }>): number | null {
  if (attempts.length === 0) return null;
  return attempts.reduce((sum, attempt) => sum + attempt.scorePct, 0) / attempts.length;
}

/**
 * Reads all level evidence for a user from the DB. Returns null when the user
 * has no profile (we cannot place them on the CEFR scale yet).
 *
 * Implementation notes (R2CI-8 / R2CI-9):
 *   - Single `groupBy({by:["vote"]})` covers all feedback vote types in one
 *     round-trip (earlier code issued two separate count queries).
 *   - `readingProgress.count()` is used instead of `findMany()` so no full
 *     rows are over-selected from the reading-progress table.
 *   - Profile-independent queries (feedback, quiz, skill) are fetched in
 *     parallel with `getProfile` to reduce total latency to 2 sequential
 *     network round-trips instead of waiting for profile first.
 */
export async function getLevelEvidence(
  userId: string,
): Promise<LevelEvidence | null> {
  // Fetch profile concurrently with the queries that don't depend on it.
  const [profile, feedbackRows, recentAttempts, skillProfile] = await Promise.all([
    getProfile(userId),
    prisma.articleDifficultyFeedback.groupBy({
      by: ["vote"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.quizAttempt.findMany({
      where: { userId },
      orderBy: { completedAt: "desc" },
      take: 20,
      select: { scorePct: true },
    }),
    getSkillProfile(userId),
  ]);

  if (!profile) return null;

  const currentLevel = normalizeEnglishLevel(profile.englishLevel);

  // Separate round-trip: this query depends on `currentLevel` from profile.
  const completedAtLevel = await prisma.readingProgress.count({
    where: {
      userId,
      completed: true,
      article: { ...publicListableArticleWhere(), difficulty: currentLevel },
    },
  });

  const feedback = feedbackCountsFromRows(feedbackRows as FeedbackGroupRow[]);
  const avgQuizScore = averageQuizScore(recentAttempts);

  return {
    currentLevel,
    feedback,
    avgQuizScore,
    quizAttemptCount: recentAttempts.length,
    completedAtLevel,
    skillConfidence: skillProfile.totalEvidence > 0 ? skillProfile.overallConfidence : null,
    skillEvidenceCount: skillProfile.totalEvidence,
  };
}

/**
 * Convenience: gathers evidence then computes the adaptive recommendation.
 * Returns null when the user has no profile yet.
 */
export async function getAdaptiveLevelRecommendation(
  userId: string,
): Promise<AdaptiveLevelRecommendation | null> {
  const evidence = await getLevelEvidence(userId);
  if (!evidence) return null;
  return computeAdaptiveLevel(evidence);
}
