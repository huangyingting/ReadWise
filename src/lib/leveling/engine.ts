/**
 * Leveling engine — pure, zero I/O.
 *
 * Contains:
 *   - {@link recommendLevelChange}  — quiz-only recommendation (#37)
 *   - {@link computeAdaptiveLevel}  — evidence-based adaptive recommendation (RW-040)
 *   - {@link difficultyBiasFromFeedback}  — helper used by computeAdaptiveLevel
 *
 * No Prisma, no DB access. Evidence is gathered by {@link ./index} and passed in.
 */

import { ENGLISH_LEVELS } from "@/lib/option-registries";
import { levelRank } from "./cefr-primitives";
import type {
  LevelingSignals,
  LevelRecommendation,
  LevelEvidence,
  AdaptiveLevelRecommendation,
  FeedbackCounts,
} from "./types";
import {
  MIN_QUIZ_ATTEMPTS,
  MIN_COMPLETIONS,
  MASTERY_THRESHOLD,
  STRUGGLE_THRESHOLD,
  MIN_FEEDBACK_VOTES,
  BIAS_DOWN_THRESHOLD,
  BIAS_UP_THRESHOLD,
  SKILL_UP_CONFIDENCE,
  SKILL_DOWN_CONFIDENCE,
  MIN_SKILL_EVIDENCE,
} from "./types";

// ---------------------------------------------------------------------------
// Quiz-only recommendation
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

  // Level-UP signals
  if (hasSufficientQuizData && avgQuizScore >= MASTERY_THRESHOLD) {
    const nextRank = currentRank + 1;
    if (nextRank < ENGLISH_LEVELS.length) {
      const targetLevel = ENGLISH_LEVELS[nextRank];
      const confidence = hasSufficientCompletionData
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

  // Level-DOWN signals
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

  // Hold — sparse data or within normal range
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

// ---------------------------------------------------------------------------
// Adaptive recommendation helpers
// ---------------------------------------------------------------------------

/**
 * Net difficulty preference from feedback votes, in −1…+1.
 *   (too_easy − too_hard) / total. Returns 0 when there are no votes.
 */
export function difficultyBiasFromFeedback(counts: FeedbackCounts): number {
  const total = counts.too_easy + counts.just_right + counts.too_hard;
  if (total <= 0) return 0;
  return (counts.too_easy - counts.too_hard) / total;
}

function pct(n: number): number {
  return Math.round(n * 100);
}

/**
 * Combines all evidence into a single transparent recommendation. PURE — no DB.
 *
 * Each signal casts a vote up or down; the majority wins (ties hold). The
 * recommended ENGINE level shifts one CEFR band in the winning direction so
 * recommendations adapt immediately, while the explicit profile level is left
 * for the user to confirm. Returns "hold" when no signal has enough evidence.
 */
export function computeAdaptiveLevel(
  evidence: LevelEvidence,
): AdaptiveLevelRecommendation {
  const { currentLevel, feedback, avgQuizScore, quizAttemptCount } = evidence;
  const currentRank = levelRank(currentLevel);
  const maxRank = ENGLISH_LEVELS.length - 1;
  const bias = difficultyBiasFromFeedback(feedback);
  const totalFeedback = feedback.too_easy + feedback.just_right + feedback.too_hard;

  const base: AdaptiveLevelRecommendation = {
    suggestion: "hold",
    currentLevel,
    recommendedLevel: currentLevel,
    targetLevel: null,
    confidence: 0,
    difficultyBias: Math.round(bias * 100) / 100,
    explanation: [],
    evidence,
  };

  const upReasons: string[] = [];
  const downReasons: string[] = [];

  // Quiz performance
  const hasQuiz = avgQuizScore !== null && quizAttemptCount >= MIN_QUIZ_ATTEMPTS;
  if (hasQuiz && avgQuizScore !== null) {
    if (avgQuizScore >= MASTERY_THRESHOLD) {
      upReasons.push(
        `Your recent quiz average is ${Math.round(avgQuizScore)}% across ${quizAttemptCount} attempts — comfortably above mastery.`,
      );
    } else if (avgQuizScore < STRUGGLE_THRESHOLD) {
      downReasons.push(
        `Your recent quiz average is ${Math.round(avgQuizScore)}% across ${quizAttemptCount} attempts — below the comfortable range.`,
      );
    }
  }

  // Difficulty feedback
  if (totalFeedback >= MIN_FEEDBACK_VOTES) {
    if (bias <= BIAS_DOWN_THRESHOLD) {
      downReasons.push(
        `You rated ${feedback.too_hard} of ${totalFeedback} recent articles "too hard".`,
      );
    } else if (bias >= BIAS_UP_THRESHOLD) {
      upReasons.push(
        `You rated ${feedback.too_easy} of ${totalFeedback} recent articles "too easy".`,
      );
    }
  }

  // Skill mastery confidence
  const hasSkill =
    evidence.skillConfidence !== null &&
    evidence.skillEvidenceCount >= MIN_SKILL_EVIDENCE;
  if (hasSkill && evidence.skillConfidence !== null) {
    if (evidence.skillConfidence >= SKILL_UP_CONFIDENCE) {
      upReasons.push(
        `Your skill confidence is ${pct(evidence.skillConfidence)}% across your learning activities.`,
      );
    } else if (evidence.skillConfidence < SKILL_DOWN_CONFIDENCE) {
      downReasons.push(
        `Your skill confidence is only ${pct(evidence.skillConfidence)}% — more practice at an easier level will help.`,
      );
    }
  }

  const upVotes = upReasons.length;
  const downVotes = downReasons.length;

  // No usable evidence → hold (sparse)
  if (upVotes === 0 && downVotes === 0) {
    return {
      ...base,
      explanation: [
        "Not enough evidence yet to adjust your level. Keep reading, taking quizzes and rating article difficulty.",
      ],
    };
  }

  const agreement = Math.abs(upVotes - downVotes) / (upVotes + downVotes);

  // Level UP
  if (upVotes > downVotes && currentRank >= 0 && currentRank < maxRank) {
    const targetLevel = ENGLISH_LEVELS[currentRank + 1];
    const confidence = Math.round(
      Math.min(1, 0.5 + 0.3 * agreement + 0.05 * upVotes) * 100,
    ) / 100;
    return {
      ...base,
      suggestion: "up",
      recommendedLevel: targetLevel,
      targetLevel,
      confidence,
      explanation: [
        `We're nudging your recommendations toward ${targetLevel}.`,
        ...upReasons,
      ],
    };
  }

  // Level DOWN
  if (downVotes > upVotes && currentRank > 0) {
    const targetLevel = ENGLISH_LEVELS[currentRank - 1];
    const confidence = Math.round(
      Math.min(1, 0.5 + 0.3 * agreement + 0.05 * downVotes) * 100,
    ) / 100;
    return {
      ...base,
      suggestion: "down",
      recommendedLevel: targetLevel,
      targetLevel,
      confidence,
      explanation: [
        `We've eased your recommendations toward ${targetLevel}.`,
        ...downReasons,
      ],
    };
  }

  // Hold (conflicting evidence or already at a boundary)
  const holdReasons =
    upVotes === downVotes
      ? ["Your recent activity is mixed — staying at your current level for now."]
      : currentRank <= 0
        ? ["You're already at the easiest level — keep practising to build confidence."]
        : ["You're already at the most advanced level — keep challenging yourself."];
  return {
    ...base,
    explanation: [
      `Holding at ${currentLevel}.`,
      ...holdReasons,
      ...upReasons,
      ...downReasons,
    ],
  };
}
