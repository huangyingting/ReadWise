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
import { parseStringArray } from "@/lib/learning/primitives";
import type { RecommendationContext } from "./types";
import { WEAK_WORD_FAMILIARITY_MAX } from "./types";

/** Cap on weak-word mastery rows scanned when building the re-exposure map. */
const WEAK_WORD_ROW_LIMIT = 500;

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
  const [profile, adaptive, skillProfile, vocabAgg, progressRows, masteryRows, weakWordRows] =
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
      // Weak-word re-exposure (#808): the learner's low-familiarity words and the
      // articles known to contain them (ids only — never word text). Only fetched
      // when there are candidates to map against.
      candidateIds.length > 0
        ? prisma.wordMastery.findMany({
            where: { userId, familiarity: { lt: WEAK_WORD_FAMILIARITY_MAX } },
            select: { sourceArticleIds: true },
            take: WEAK_WORD_ROW_LIMIT,
          })
        : Promise.resolve([] as Array<{ sourceArticleIds: unknown }>),
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

  // Count, per candidate article, how many DISTINCT weak words are known to
  // appear in it. Intersected with the candidate set so the map stays small and
  // only ids/counts are retained (privacy-safe — no word text).
  const candidateSet = new Set(candidateIds);
  const weakWordArticleIds = new Map<string, number>();
  for (const row of weakWordRows) {
    const seen = new Set<string>();
    for (const articleId of parseStringArray(row.sourceArticleIds)) {
      if (!candidateSet.has(articleId) || seen.has(articleId)) continue;
      seen.add(articleId);
      weakWordArticleIds.set(articleId, (weakWordArticleIds.get(articleId) ?? 0) + 1);
    }
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
    weakWordArticleIds,
    now,
  };
}
