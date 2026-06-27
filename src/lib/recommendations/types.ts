/**
 * Shared recommendation domain types and weights — REF-010.
 *
 * No imports from other recommendation sub-modules; safe to import from any
 * layer of the subsystem without creating circular references.
 */

import type { ArticleCardSource } from "@/lib/article-library";
import type { DifficultyLevel } from "@/lib/difficulty";
import type { Skill } from "@/lib/learning/types";

// ---------------------------------------------------------------------------
// Candidate and score types
// ---------------------------------------------------------------------------

/** One candidate article to be scored. Body/content is never needed here. */
export type RecommendationCandidate = ArticleCardSource & {
  /** Tag slugs for topic matching (optional — empty when unknown). */
  tagSlugs?: string[];
};

/** The seven component sub-scores (each 0–1). */
export type ScoreComponents = {
  levelFit: number;
  topicInterest: number;
  novelty: number;
  difficultyFeedback: number;
  masteryGap: number;
  wordLoad: number;
  freshness: number;
};

/**
 * Transparent breakdown of the deterministic weak-word re-exposure booster
 * (#808). `count` is the number of the learner's distinct weak words known to
 * appear in the article; `score` is that count normalised to 0–1; `points` is
 * the capped bonus folded into `baseScore`. Privacy-safe: carries only counts —
 * never word text.
 */
export type WeakWordReexposure = {
  count: number;
  score: number;
  points: number;
};

export type ScoredRecommendation = {
  id: string;
  category: string | null;
  /** Final 0–100 score AFTER the diversity penalty. */
  score: number;
  /** 0–100 score (7 weighted components + weak-word bonus) BEFORE diversity. */
  baseScore: number;
  /** Points removed by the diversity pass (0 when not penalised). */
  diversityPenalty: number;
  components: ScoreComponents;
  /** Weak-word re-exposure booster breakdown (count/score/points). */
  weakWordReexposure: WeakWordReexposure;
  /** Short headline reason (the dominant component). */
  reason: string;
  /** Detailed, per-component human-readable notes. */
  explanation: string[];
};

/** All per-user signals needed to score candidates. Built once per request. */
export type RecommendationContext = {
  userLevel: DifficultyLevel | null;
  userLevelRank: number | null;
  topicSet: Set<string>;
  completedIds: Set<string>;
  inProgressPercent: Map<string, number>;
  masteryByArticle: Map<string, { comprehensionScore: number; lastActivityAt: Date }>;
  /** −1…+1 from difficulty feedback (neg = prefers easier). */
  difficultyBias: number;
  weakestSkill: Skill | null;
  vocab: { avgFamiliarity: number; knownCount: number };
  /**
   * articleId → count of the learner's DISTINCT weak words (low familiarity)
   * known to appear in that article (from WordMastery.sourceArticleIds). Drives
   * the deterministic weak-word re-exposure booster (#808). Only ever holds
   * candidate ids the learner already has weak-word evidence for; empty when the
   * learner has no weak words, so the signal degrades to a no-op.
   */
  weakWordArticleIds: Map<string, number>;
  now: Date;
};

// ---------------------------------------------------------------------------
// Weights (exported so tests / debugging can reference them)
// ---------------------------------------------------------------------------

export const COMPONENT_WEIGHTS: Record<keyof ScoreComponents, number> = {
  levelFit: 0.26,
  topicInterest: 0.2,
  masteryGap: 0.14,
  novelty: 0.12,
  wordLoad: 0.12,
  freshness: 0.08,
  difficultyFeedback: 0.08,
};

// ---------------------------------------------------------------------------
// Weak-word re-exposure booster tuning (#808)
// ---------------------------------------------------------------------------

/**
 * Familiarity at/above which a word is considered "known" and no longer drives
 * re-exposure. Words below this are "weak" and worth meeting again in context.
 */
export const WEAK_WORD_FAMILIARITY_MAX = 0.5;

/**
 * Distinct weak-word overlap count that earns the full booster. Beyond this the
 * signal saturates so a single dense article cannot dominate the feed.
 */
export const WEAK_WORD_REEXPOSURE_TARGET = 3;

/**
 * Maximum points (out of 100) the booster may add to an article's base score.
 * Intentionally small so it nudges — never overwhelms — the seven weighted
 * components or the comfortable word-load signal.
 */
export const WEAK_WORD_REEXPOSURE_MAX_POINTS = 8;
