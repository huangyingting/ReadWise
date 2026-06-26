/**
 * Quiz-only CEFR level recommendation — #37.
 *
 * Pure function {@link recommendLevelChange} over {@link LevelingSignals}.
 * The evidence-based adaptive layer lives in {@link ./queries}.
 */

import { ENGLISH_LEVELS, type EnglishLevel } from "@/lib/option-registries";
import { levelRank } from "./cefr-primitives";

// ---------------------------------------------------------------------------
// Types
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
// Thresholds
// ---------------------------------------------------------------------------

/** Minimum quiz attempts needed before we trust the score signal. */
const MIN_QUIZ_ATTEMPTS = 3;

/** Minimum completed articles before we trust the completion signal. */
const MIN_COMPLETIONS = 2;

/**
 * Quiz score above this threshold (and enough attempts) → suggest level up.
 * Research: mastery is typically defined at ≥85% on SRS quizzes.
 */
const MASTERY_THRESHOLD = 85;

/**
 * Quiz score below this threshold (and enough attempts) → suggest level down.
 */
const STRUGGLE_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// Pure recommendation logic
// ---------------------------------------------------------------------------

/**
 * Derives a level-change recommendation from observable signals.
 * Returns a "hold" recommendation when data is too sparse to be meaningful.
 */
export function recommendLevelChange(
  signals: LevelingSignals,
): LevelRecommendation {
  const { avgQuizScore, quizAttemptCount, completedAtLevel, currentLevel } =
    signals;

  const currentRank = levelRank(currentLevel);
  const hasSufficientQuizData =
    avgQuizScore !== null && quizAttemptCount >= MIN_QUIZ_ATTEMPTS;
  const hasSufficientCompletionData = completedAtLevel >= MIN_COMPLETIONS;

  // -------------------------------------------------------------------
  // Level-UP signals
  // -------------------------------------------------------------------
  if (hasSufficientQuizData && avgQuizScore >= MASTERY_THRESHOLD) {
    const nextRank = currentRank + 1;
    if (nextRank < ENGLISH_LEVELS.length) {
      const targetLevel = ENGLISH_LEVELS[nextRank];
      const confidence =
        hasSufficientCompletionData
          ? Math.min(1, (avgQuizScore - MASTERY_THRESHOLD) / 15 + 0.7)
          : 0.6;
      return {
        suggestion: "up",
        confidence: Math.round(confidence * 100) / 100,
        rationale: `Your average quiz score is ${Math.round(avgQuizScore)}% across ${quizAttemptCount} attempts — consistently above the mastery threshold. You're ready for ${targetLevel}.`,
        targetLevel,
      };
    }
  }

  // -------------------------------------------------------------------
  // Level-DOWN signals
  // -------------------------------------------------------------------
  if (hasSufficientQuizData && avgQuizScore < STRUGGLE_THRESHOLD) {
    const prevRank = currentRank - 1;
    if (prevRank >= 0) {
      const targetLevel = ENGLISH_LEVELS[prevRank];
      const confidence = Math.min(
        1,
        (STRUGGLE_THRESHOLD - avgQuizScore) / 30 + 0.55,
      );
      return {
        suggestion: "down",
        confidence: Math.round(confidence * 100) / 100,
        rationale: `Your average quiz score is ${Math.round(avgQuizScore)}% across ${quizAttemptCount} attempts — consistently below the target. Dropping to ${targetLevel} will help build confidence.`,
        targetLevel,
      };
    }
  }

  // -------------------------------------------------------------------
  // Hold — sparse data or within normal range
  // -------------------------------------------------------------------
  const reason =
    !hasSufficientQuizData && !hasSufficientCompletionData
      ? "Not enough reading and quiz data yet to make a recommendation. Keep going!"
      : "Your performance is on track for your current level. Keep reading!";

  return {
    suggestion: "hold",
    confidence: 0,
    rationale: reason,
    targetLevel: null,
  };
}
