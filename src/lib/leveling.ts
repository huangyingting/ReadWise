/**
 * Adaptive CEFR level progression — #37 + RW-040.
 *
 * Two layers live here:
 *
 *   1. The original quiz-only {@link recommendLevelChange} (#37) — a PURE
 *      function over {@link LevelingSignals}, kept intact and unit-tested.
 *
 *   2. The richer, evidence-based adaptive layer (RW-040): it combines per-article
 *      difficulty feedback (`too_easy`/`just_right`/`too_hard`), recent quiz
 *      performance, reading completion at level AND the user's SkillMastery
 *      confidence into a single transparent {@link AdaptiveLevelRecommendation}
 *      that EXPLAINS any level change. {@link computeAdaptiveLevel} is PURE
 *      (over {@link LevelEvidence}); {@link getLevelEvidence} /
 *      {@link getAdaptiveLevelRecommendation} read the DB.
 *
 * The adaptive `recommendedLevel` is the level the recommendation engine should
 * TARGET right now — repeated `too_hard` lowers it (easier content) and repeated
 * strong performance raises it — WITHOUT mutating the user's explicit profile
 * level (that always stays an opt-in action via the level banner → PUT /api/profile,
 * which records the change in `LevelHistory`).
 */

import { prisma } from "@/lib/prisma";
import { ENGLISH_LEVELS, getProfile, type EnglishLevel } from "@/lib/profile";
import { levelRank } from "@/lib/difficulty";
import { getSkillProfile } from "@/lib/skill-mastery";
import { publicListableArticleWhere } from "@/lib/article-access";

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

// ----------------------------------------------------------------------
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

// ===========================================================================
// RW-040 — Evidence-based adaptive leveling
// ===========================================================================

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

// ---- Thresholds (adaptive layer) ------------------------------------------

/** Minimum difficulty-feedback votes before the bias is trusted. */
const MIN_FEEDBACK_VOTES = 3;
/** Feedback bias at/below which the user is clearly over-challenged. */
const BIAS_DOWN_THRESHOLD = -0.4;
/** Feedback bias at/above which content is clearly too easy. */
const BIAS_UP_THRESHOLD = 0.4;
/** SkillMastery confidence at/above which a level-up is supported. */
const SKILL_UP_CONFIDENCE = 0.8;
/** SkillMastery confidence below which a level-down is supported. */
const SKILL_DOWN_CONFIDENCE = 0.4;
/** Minimum SkillMastery evidence items before that signal is trusted. */
const MIN_SKILL_EVIDENCE = 4;

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

  // ---- Quiz performance --------------------------------------------------
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

  // ---- Difficulty feedback ----------------------------------------------
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

  // ---- Skill mastery confidence -----------------------------------------
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

  // ---- No usable evidence → hold (sparse) -------------------------------
  if (upVotes === 0 && downVotes === 0) {
    return {
      ...base,
      explanation: [
        "Not enough evidence yet to adjust your level. Keep reading, taking quizzes and rating article difficulty.",
      ],
    };
  }

  const agreement = Math.abs(upVotes - downVotes) / (upVotes + downVotes);

  // ---- Level UP ----------------------------------------------------------
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

  // ---- Level DOWN --------------------------------------------------------
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

  // ---- Hold (conflicting evidence or already at a boundary) -------------
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

/**
 * Reads all level evidence for a user from the DB. Returns null when the user
 * has no profile (we cannot place them on the CEFR scale yet).
 */
export async function getLevelEvidence(
  userId: string,
): Promise<LevelEvidence | null> {
  const profile = await getProfile(userId);
  if (!profile) return null;

  const currentLevel = (ENGLISH_LEVELS as readonly string[]).includes(
    profile.englishLevel,
  )
    ? (profile.englishLevel as EnglishLevel)
    : ENGLISH_LEVELS[0];

  const [feedbackRows, recentAttempts, completedAtLevel, skillProfile] =
    await Promise.all([
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
      prisma.readingProgress.count({
        where: {
          userId,
          completed: true,
          article: { ...publicListableArticleWhere(), difficulty: currentLevel },
        },
      }),
      getSkillProfile(userId),
    ]);

  const feedback: FeedbackCounts = { too_easy: 0, just_right: 0, too_hard: 0 };
  for (const row of feedbackRows as Array<{ vote: string; _count: { _all: number } }>) {
    if (row.vote === "too_easy") feedback.too_easy = row._count._all;
    else if (row.vote === "just_right") feedback.just_right = row._count._all;
    else if (row.vote === "too_hard") feedback.too_hard = row._count._all;
  }

  const avgQuizScore =
    recentAttempts.length > 0
      ? recentAttempts.reduce((sum, a) => sum + a.scorePct, 0) /
        recentAttempts.length
      : null;

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
