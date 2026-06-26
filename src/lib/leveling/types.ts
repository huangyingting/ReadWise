/**
 * Shared types and constants for the leveling subsystem.
 *
 * Imported by both the pure engine ({@link ./engine}) and the DB-backed
 * readers ({@link ./index}). No Prisma, no I/O.
 */

import type { EnglishLevel } from "@/lib/option-registries";

// ---------------------------------------------------------------------------
// Quiz-only layer types (originally from recommendation.ts — #37)
// ---------------------------------------------------------------------------

export type LevelSuggestion = "up" | "down" | "hold";

export type LevelRecommendation = {
  suggestion: LevelSuggestion;
  /** 0–1: fraction of signals that agree with the suggestion. */
  confidence: number;
  rationale: string;
  /** Target level when suggestion is "up" or "down", null for "hold". */
  targetLevel: EnglishLevel | null;
};

export type LevelingSignals = {
  /** Average quiz score (0–100) for articles at-or-above current level, recent N attempts. */
  avgQuizScore: number | null;
  /** Number of quiz attempts contributing to avgQuizScore. */
  quizAttemptCount: number;
  /** Number of articles at current level that the user has completed (≥95%). */
  completedAtLevel: number;
  /** Number of published articles at current level (to normalize completedAtLevel). */
  totalAtLevel: number;
  currentLevel: EnglishLevel;
};

// ---------------------------------------------------------------------------
// Adaptive layer types (originally from queries.ts — RW-040)
// ---------------------------------------------------------------------------

/** Difficulty-feedback vote tallies for a user across all rated articles. */
export type FeedbackCounts = {
  too_easy: number;
  just_right: number;
  too_hard: number;
};

/**
 * All the observable evidence the adaptive recommender combines. Gathered by
 * {@link getLevelEvidence}; consumed by the PURE {@link computeAdaptiveLevel}.
 */
export type LevelEvidence = {
  currentLevel: EnglishLevel;
  /** Difficulty-feedback vote tallies (too_easy / just_right / too_hard). */
  feedback: FeedbackCounts;
  /** Average of recent quiz scores (0–100), or null when none. */
  avgQuizScore: number | null;
  /** Number of recent quiz attempts behind `avgQuizScore`. */
  quizAttemptCount: number;
  /** Articles AT the current level the user has completed (≥95%). */
  completedAtLevel: number;
  /** Overall SkillMastery confidence (0–1), or null when no evidence. */
  skillConfidence: number | null;
  /** Total SkillMastery evidence items recorded. */
  skillEvidenceCount: number;
};

export type AdaptiveLevelRecommendation = {
  suggestion: LevelSuggestion;
  currentLevel: EnglishLevel;
  /**
   * Level the recommendation engine should target NOW (may differ from the
   * user's profile level: lowered on repeated "too hard", raised on repeated
   * strong performance). Equals `currentLevel` when holding.
   */
  recommendedLevel: EnglishLevel;
  /** Concrete level to move to when suggestion is "up"/"down", else null. */
  targetLevel: EnglishLevel | null;
  /** 0–1 trust in the recommendation (0 when holding on sparse data). */
  confidence: number;
  /**
   * −1…+1 difficulty preference from feedback: negative = user keeps finding
   * articles too hard (prefer easier), positive = too easy (prefer harder).
   */
  difficultyBias: number;
  /** Human-readable, deterministic reasons behind the recommendation. */
  explanation: string[];
  evidence: LevelEvidence;
};

// ---------------------------------------------------------------------------
// Thresholds — shared by both quiz-only and adaptive layers
// ---------------------------------------------------------------------------

/** Minimum quiz attempts needed before we trust the score signal. */
export const MIN_QUIZ_ATTEMPTS = 3;

/** Minimum completed articles before we trust the completion signal. */
export const MIN_COMPLETIONS = 2;

/**
 * Quiz score above this threshold (and enough attempts) → suggest level up.
 * Research: mastery is typically defined at ≥85% on SRS quizzes.
 */
export const MASTERY_THRESHOLD = 85;

/**
 * Quiz score below this threshold (and enough attempts) → suggest level down.
 */
export const STRUGGLE_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// Thresholds — adaptive layer only
// ---------------------------------------------------------------------------

/** Minimum difficulty-feedback votes before the bias is trusted. */
export const MIN_FEEDBACK_VOTES = 3;
/** Feedback bias at/below which the user is clearly over-challenged. */
export const BIAS_DOWN_THRESHOLD = -0.4;
/** Feedback bias at/above which content is clearly too easy. */
export const BIAS_UP_THRESHOLD = 0.4;
/** SkillMastery confidence at/above which a level-up is supported. */
export const SKILL_UP_CONFIDENCE = 0.8;
/** SkillMastery confidence below which a level-down is supported. */
export const SKILL_DOWN_CONFIDENCE = 0.4;
/** Minimum SkillMastery evidence items before that signal is trusted. */
export const MIN_SKILL_EVIDENCE = 4;
