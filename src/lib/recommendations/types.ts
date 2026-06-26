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

export type ScoredRecommendation = {
  id: string;
  category: string | null;
  /** Final 0–100 score AFTER the diversity penalty. */
  score: number;
  /** 0–100 weighted score BEFORE the diversity penalty. */
  baseScore: number;
  /** Points removed by the diversity pass (0 when not penalised). */
  diversityPenalty: number;
  components: ScoreComponents;
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
