/**
 * Recommendation context loading — REF-010.
 *
 * Loads every per-user signal from the DB needed to score candidates. Degrades
 * gracefully for a brand-new user (no profile / no mastery): level + topic
 * become neutral, every article reads as novel, and bias/vocab are empty.
 */

import { prisma } from "@/lib/prisma";
import { isDifficultyLevel, levelRank } from "@/lib/leveling/cefr-primitives";
import { getProfile } from "@/lib/profile";
import { parseTopics } from "@/lib/profile";
import { getAdaptiveLevelRecommendation } from "@/lib/leveling";
import { getSkillProfile } from "@/lib/learning/skill-mastery";
import type { RecommendationContext } from "./types";

/**
 * Loads every per-user signal needed to score the given candidates. Degrades
 * gracefully for a brand-new user (no profile / no mastery): level + topic
 * become neutral, every article reads as novel, and bias/vocab are empty.
 */
export async function buildRecommendationContext(
  userId: string,
  candidateIds: string[],
  now: Date = new Date(),
): Promise<RecommendationContext> {
  const [profile, adaptive, skillProfile, vocabAgg, progressRows, masteryRows] =
    await Promise.all([
      getProfile(userId),
      getAdaptiveLevelRecommendation(userId),
      getSkillProfile(userId),
      prisma.wordMastery.aggregate({
        where: { userId },
        _avg: { familiarity: true },
        _count: { _all: true },
      }),
      candidateIds.length > 0
        ? prisma.readingProgress.findMany({
            where: { userId, articleId: { in: candidateIds } },
            select: { articleId: true, percent: true, completed: true },
          })
        : Promise.resolve([] as Array<{ articleId: string; percent: number; completed: boolean }>),
      candidateIds.length > 0
        ? prisma.articleMastery.findMany({
            where: { userId, articleId: { in: candidateIds } },
            select: { articleId: true, comprehensionScore: true, lastActivityAt: true },
          })
        : Promise.resolve(
            [] as Array<{ articleId: string; comprehensionScore: number; lastActivityAt: Date }>,
          ),
    ]);

  // The adaptive recommendation already factors feedback + quiz + skills, so
  // its `recommendedLevel` is the level the engine should centre on.
  const userLevel =
    adaptive
      ? adaptive.recommendedLevel
      : isDifficultyLevel(profile?.englishLevel)
        ? profile.englishLevel
        : null;
  const userLevelRank = userLevel ? levelRank(userLevel) : null;

  const completedIds = new Set<string>();
  const inProgressPercent = new Map<string, number>();
  for (const row of progressRows) {
    if (row.completed) completedIds.add(row.articleId);
    else if (row.percent > 0) inProgressPercent.set(row.articleId, row.percent);
  }

  const masteryByArticle = new Map<
    string,
    { comprehensionScore: number; lastActivityAt: Date }
  >();
  for (const row of masteryRows) {
    masteryByArticle.set(row.articleId, {
      comprehensionScore: row.comprehensionScore,
      lastActivityAt: row.lastActivityAt,
    });
  }

  return {
    userLevel,
    userLevelRank,
    topicSet: new Set(parseTopics(profile?.topics)),
    completedIds,
    inProgressPercent,
    masteryByArticle,
    difficultyBias: adaptive?.difficultyBias ?? 0,
    weakestSkill: skillProfile.weakest,
    vocab: {
      avgFamiliarity: vocabAgg._avg.familiarity ?? 0,
      knownCount: vocabAgg._count._all ?? 0,
    },
    now,
  };
}
