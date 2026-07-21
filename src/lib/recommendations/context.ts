/**
 * Recommendation context loading — REF-010.
 *
 * Loads every per-user signal from the DB needed to score candidates. Degrades
 * gracefully for a brand-new user (no profile / no mastery): level + topic
 * become neutral, every article reads as novel, and bias/vocab are empty.
 */

import { prisma } from "@/lib/prisma";
import {
  isDifficultyLevel,
  levelRank,
  type EnglishLevel,
} from "@/lib/leveling/cefr-primitives";
import { getProfile } from "@/lib/profile";
import { parseTopics } from "@/lib/profile";
import { getAdaptiveLevelRecommendation } from "@/lib/leveling";
import { getSkillProfile } from "@/lib/learning/skill-mastery";
import { isGoalPath } from "@/lib/learning/goal-path";
import {
  parseStringArray,
  WEAK_REEXPOSURE_FAMILIARITY,
} from "@/lib/learning/primitives";
import type { RecommendationContext } from "./types";

/** Cap on weak-word mastery rows scanned when building the re-exposure map. */
const WEAK_WORD_ROW_LIMIT = 500;

type ReadingProgressRow = { articleId: string; percent: number; completed: boolean };
type ArticleMasteryRow = {
  articleId: string;
  comprehensionScore: number;
  lastActivityAt: Date;
};
type WeakWordRow = { sourceArticleIds: unknown };
type AdaptiveLevelSignal = Awaited<ReturnType<typeof getAdaptiveLevelRecommendation>>;

/**
 * Loads every per-user signal needed to score the given candidates. Degrades
 * gracefully for a brand-new user (no profile / no mastery): level + topic
 * become neutral, every article reads as novel, and bias/vocab are empty.
 */
export async function buildRecommendationContext(
  userId: string,
  candidateIds: string[],
  now: Date = new Date(),
  opts: { placementLevel?: EnglishLevel | null } = {},
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
      fetchReadingProgressRows(userId, candidateIds),
      fetchArticleMasteryRows(userId, candidateIds),
      // Weak-word re-exposure (#808): the learner's low-familiarity words and the
      // articles known to contain them (ids only — never word text). Only fetched
      // when there are candidates to map against.
      fetchWeakWordRows(userId, candidateIds),
    ]);

  // The adaptive recommendation already factors feedback + quiz + skills, so
  // its `recommendedLevel` is the level the engine should centre on.
  const userLevel = resolveUserLevel(profile?.englishLevel, adaptive, opts.placementLevel);
  const userLevelRank = userLevel ? levelRank(userLevel) : null;

  const { completedIds, inProgressPercent } = buildReadingProgressMaps(progressRows);
  const masteryByArticle = buildMasteryByArticle(masteryRows);
  const weakWordArticleIds = buildWeakWordArticleIds(candidateIds, weakWordRows);

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
    // Goal Paths (#809): the learner's controlled goal-path string (or null).
    // Only the explicitly-selected enum is read — never inferred from history.
    goalPath: isGoalPath(profile?.goalPath) ? profile.goalPath : null,
    now,
  };
}

function fetchReadingProgressRows(
  userId: string,
  candidateIds: string[],
): Promise<ReadingProgressRow[]> {
  if (candidateIds.length === 0) return Promise.resolve([]);
  return prisma.readingProgress.findMany({
    where: { userId, articleId: { in: candidateIds } },
    select: { articleId: true, percent: true, completed: true },
  });
}

function fetchArticleMasteryRows(
  userId: string,
  candidateIds: string[],
): Promise<ArticleMasteryRow[]> {
  if (candidateIds.length === 0) return Promise.resolve([]);
  return prisma.articleMastery.findMany({
    where: { userId, articleId: { in: candidateIds } },
    select: { articleId: true, comprehensionScore: true, lastActivityAt: true },
  });
}

function fetchWeakWordRows(
  userId: string,
  candidateIds: string[],
): Promise<WeakWordRow[]> {
  if (candidateIds.length === 0) return Promise.resolve([]);
  return prisma.wordMastery.findMany({
    where: { userId, familiarity: { lt: WEAK_REEXPOSURE_FAMILIARITY } },
    select: { sourceArticleIds: true },
    orderBy: [{ familiarity: "asc" }, { id: "asc" }],
    take: WEAK_WORD_ROW_LIMIT,
  });
}

function resolveUserLevel(
  profileLevel: unknown,
  adaptive: AdaptiveLevelSignal,
  placementLevel: EnglishLevel | null | undefined,
): EnglishLevel | null {
  const adaptiveLevel = adaptive
    ? adaptive.recommendedLevel
    : isDifficultyLevel(profileLevel)
      ? profileLevel
      : null;

  // Cold-start placement override (#806): when the caller supplies a placement
  // recommendedLevel, it takes precedence as the centring level so a brand-new
  // learner's first picks land near their measured level instead of relying on
  // self-report alone. Absent/invalid → falls back to the adaptive/profile
  // signal, leaving existing behaviour unchanged.
  const validPlacementLevel =
    placementLevel && isDifficultyLevel(placementLevel) ? placementLevel : null;
  return validPlacementLevel ?? adaptiveLevel;
}

function buildReadingProgressMaps(progressRows: ReadingProgressRow[]): {
  completedIds: Set<string>;
  inProgressPercent: Map<string, number>;
} {
  const completedIds = new Set<string>();
  const inProgressPercent = new Map<string, number>();
  for (const row of progressRows) {
    if (row.completed) completedIds.add(row.articleId);
    else if (row.percent > 0) inProgressPercent.set(row.articleId, row.percent);
  }
  return { completedIds, inProgressPercent };
}

function buildMasteryByArticle(
  masteryRows: ArticleMasteryRow[],
): Map<string, { comprehensionScore: number; lastActivityAt: Date }> {
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
  return masteryByArticle;
}

function buildWeakWordArticleIds(
  candidateIds: string[],
  weakWordRows: WeakWordRow[],
): Map<string, number> {
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
  return weakWordArticleIds;
}
