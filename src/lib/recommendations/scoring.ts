/**
 * Pure recommendation scoring — REF-010.
 *
 * Composes discovery-ranking primitives (levelFitScore, freshnessScore01,
 * topicInterestScore) from @/lib/discovery-ranking with recommendation-specific
 * signals (novelty, difficultyFeedback, wordLoad, masteryGap) to produce a
 * fully-explained ScoredRecommendation for each candidate.
 *
 * All functions are PURE (no DB / no I/O). Use buildRecommendationContext
 * (context.ts) to assemble the RecommendationContext before calling these.
 */

import { isDifficultyLevel, levelRank } from "@/lib/leveling/cefr-primitives";
import { clamp01 } from "@/lib/primitives/pure";
import {
  levelFitScore,
  freshnessScore01,
  topicInterestScore,
} from "@/lib/discovery-ranking";
import type { Skill } from "@/lib/learning/types";
import type {
  RecommendationCandidate,
  ScoreComponents,
  ScoredRecommendation,
  RecommendationContext,
} from "./types";
import { COMPONENT_WEIGHTS } from "./types";
import { headlineReason, buildExplanationLines } from "./explanations";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Clamps a CEFR delta into the [-3, 3] band used by the scorers. */
function clampDelta(delta: number): number {
  return Math.max(-3, Math.min(3, delta));
}

// ---------------------------------------------------------------------------
// Pure component scorers
// ---------------------------------------------------------------------------

/**
 * Novelty (0–1). Completed articles score 0 (nothing new); in-progress 0.45;
 * articles seen recently (have mastery activity) decay by recency; never-seen
 * articles score 1.
 */
export function noveltyScore(
  articleId: string,
  completedIds: Set<string>,
  inProgressPercent: Map<string, number>,
  masteryByArticle: Map<string, { comprehensionScore: number; lastActivityAt: Date }>,
  now: Date,
): number {
  if (completedIds.has(articleId)) return 0;
  const percent = inProgressPercent.get(articleId);
  if (percent != null && percent > 0) return 0.45;
  const mastery = masteryByArticle.get(articleId);
  if (mastery) {
    const ageDays =
      (now.getTime() - new Date(mastery.lastActivityAt).getTime()) / 86_400_000;
    if (ageDays <= 3) return 0.3;
    if (ageDays <= 14) return 0.6;
    return 0.85;
  }
  return 1;
}

/**
 * Difficulty-feedback nudge (0–1). Rewards articles whose difficulty aligns
 * with the direction the user's feedback prefers.
 */
export function difficultyFeedbackScore(
  articleRank: number | null,
  userRank: number | null,
  bias: number,
): number {
  if (articleRank == null || articleRank < 0 || userRank == null) return 0.5;
  const delta = clampDelta(articleRank - userRank);
  return clamp01(0.5 + 0.2 * bias * delta);
}

/**
 * Comfortable unknown-word load (0–1) from the article's level relative to
 * the user and their overall WordMastery strength.
 */
export function wordLoadScore(
  articleRank: number | null,
  userRank: number | null,
  vocab: { avgFamiliarity: number; knownCount: number },
): number {
  const delta =
    articleRank == null || articleRank < 0 || userRank == null
      ? 0
      : clampDelta(articleRank - userRank);
  const vocabStrength = clamp01(
    0.5 * clamp01(vocab.avgFamiliarity) + 0.5 * Math.min(1, vocab.knownCount / 200),
  );
  const expectedLoad = clamp01(0.35 + 0.18 * delta - 0.25 * vocabStrength);
  return clamp01(1 - Math.abs(expectedLoad - 0.3) / 0.7);
}

/**
 * Mastery-gap opportunity (0–1). High when there is room to learn, with a
 * small boost when the article targets the user's weakest skill.
 */
export function masteryGapScore(
  articleId: string,
  articleRank: number | null,
  userRank: number | null,
  masteryByArticle: Map<string, { comprehensionScore: number; lastActivityAt: Date }>,
  weakestSkill: Skill | null,
): number {
  const mastery = masteryByArticle.get(articleId);
  let gap = mastery ? 1 - clamp01(mastery.comprehensionScore) : 0.7;

  if (weakestSkill && articleRank != null && articleRank >= 0 && userRank != null) {
    const delta = articleRank - userRank;
    if (
      (weakestSkill === "reading" || weakestSkill === "comprehension") &&
      delta <= 0
    ) {
      gap += 0.15;
    } else if (
      (weakestSkill === "vocabulary" || weakestSkill === "grammar") &&
      delta >= 0 &&
      delta <= 1
    ) {
      gap += 0.15;
    }
  }
  return clamp01(gap);
}

// ---------------------------------------------------------------------------
// Candidate scorer
// ---------------------------------------------------------------------------

/**
 * Scores a single candidate for a user. PURE — all per-user signals come from
 * `ctx`. Diversity is applied later (see rankWithDiversity in diversity.ts).
 */
export function scoreCandidate(
  candidate: RecommendationCandidate,
  ctx: RecommendationContext,
): ScoredRecommendation {
  const articleRank =
    candidate.difficulty && isDifficultyLevel(candidate.difficulty)
      ? levelRank(candidate.difficulty)
      : null;
  const tagSlugs = candidate.tagSlugs ?? [];

  const components: ScoreComponents = {
    levelFit: levelFitScore(articleRank, ctx.userLevelRank),
    topicInterest: topicInterestScore(candidate.category, tagSlugs, ctx.topicSet),
    novelty: noveltyScore(
      candidate.id,
      ctx.completedIds,
      ctx.inProgressPercent,
      ctx.masteryByArticle,
      ctx.now,
    ),
    difficultyFeedback: difficultyFeedbackScore(
      articleRank,
      ctx.userLevelRank,
      ctx.difficultyBias,
    ),
    masteryGap: masteryGapScore(
      candidate.id,
      articleRank,
      ctx.userLevelRank,
      ctx.masteryByArticle,
      ctx.weakestSkill,
    ),
    wordLoad: wordLoadScore(articleRank, ctx.userLevelRank, ctx.vocab),
    freshness: freshnessScore01(candidate.publishedAt ?? null, ctx.now),
  };

  let weighted = 0;
  for (const key of Object.keys(components) as Array<keyof ScoreComponents>) {
    weighted += components[key] * COMPONENT_WEIGHTS[key];
  }
  const baseScore = Math.round(weighted * 1000) / 10; // 0–100, 1dp

  return {
    id: candidate.id,
    category: candidate.category ?? null,
    score: baseScore,
    baseScore,
    diversityPenalty: 0,
    components,
    reason: headlineReason(candidate, components, ctx),
    explanation: buildExplanationLines(components),
  };
}
