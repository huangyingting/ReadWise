/**
 * Article mastery (RW-037).
 *
 * A single durable representation of how well a user understood an article,
 * combining the signals that already exist per user+article — reading
 * completion (`ReadingProgress`), best quiz score (`QuizAttempt`), dictionary
 * lookup density (saved words for the article vs its length),
 * difficulty feedback (`ArticleDifficultyFeedback`) and optionally time spent —
 * into a transparent `comprehensionScore` (0–1). Recommendations and review
 * suggestions can query this directly instead of re-deriving it everywhere.
 *
 * Scoring rules are deliberately simple and explainable (no ML): reading is
 * weak evidence on its own, a quiz score is strong evidence, and difficulty
 * feedback / heavy lookups nudge the score down or up.
 */

import { prisma } from "@/lib/prisma";
import { clamp01 } from "./primitives";

const QUIZ_COMPLETION_WEIGHT = 0.5;
const QUIZ_SCORE_WEIGHT = 0.5;
const READING_ONLY_CAP = 0.6;
const TOO_HARD_MULTIPLIER = 0.85;
const TOO_EASY_MULTIPLIER = 1.05;
const TOO_EASY_BONUS = 0.05;
const LOOKUP_DENSITY_PENALTY_PER_POINT = 0.02;
const MAX_LOOKUP_DENSITY_PENALTY = 0.15;
const LOOKUP_DENSITY_WORDS = 100;

export type ArticleMasteryRecord = {
  articleId: string;
  readingCompletion: number; // 0–1
  quizScore: number | null; // 0–1
  lookupDensity: number | null; // lookups per 100 words
  timeSpentMs: number | null;
  difficultyFeedback: string | null;
  comprehensionScore: number; // 0–1
  lastActivityAt: Date;
};

export type ComprehensionInput = {
  /** Reading completion, 0–1. */
  readingCompletion: number;
  /** Best quiz score, 0–1, or null when the user has not taken the quiz. */
  quizScore: number | null;
  /** Lookups per 100 words, or null when unknown. */
  lookupDensity: number | null;
  /** "too_easy" | "just_right" | "too_hard" | null. */
  difficultyFeedback: string | null;
};

function baseComprehensionScore(input: ComprehensionInput): number {
  const completion = clamp01(input.readingCompletion);
  if (input.quizScore != null) {
    return (
      QUIZ_COMPLETION_WEIGHT * completion +
      QUIZ_SCORE_WEIGHT * clamp01(input.quizScore)
    );
  }
  return completion * READING_ONLY_CAP;
}

function applyDifficultyFeedback(score: number, feedback: string | null): number {
  if (feedback === "too_hard") return score * TOO_HARD_MULTIPLIER;
  if (feedback === "too_easy") {
    return score * TOO_EASY_MULTIPLIER + TOO_EASY_BONUS;
  }
  return score;
}

function applyLookupDensityPenalty(
  score: number,
  lookupDensity: number | null,
): number {
  if (lookupDensity == null || lookupDensity <= 0) return score;
  const penalty = Math.min(
    MAX_LOOKUP_DENSITY_PENALTY,
    lookupDensity * LOOKUP_DENSITY_PENALTY_PER_POINT,
  );
  return score * (1 - penalty);
}

/**
 * Combines the per-article signals into a 0–1 comprehension score.
 *
 *   - With a quiz score, comprehension is an even blend of reading completion
 *     and quiz performance (the quiz is the strongest comprehension signal).
 *   - Without a quiz, reading completion alone is capped (×0.6) because
 *     scrolling to the end does not prove understanding.
 *   - "too_hard" feedback pulls the score down (the user struggled);
 *     "too_easy" nudges it up (the content was well within reach).
 *   - A high dictionary-lookup density (many unknown words) applies a small
 *     penalty, capped so it can never dominate the score.
 */
export function computeComprehensionScore(input: ComprehensionInput): number {
  let score = baseComprehensionScore(input);
  score = applyDifficultyFeedback(score, input.difficultyFeedback);
  score = applyLookupDensityPenalty(score, input.lookupDensity);
  return clamp01(score);
}

type ArticleMasteryRow = {
  articleId: string;
  readingCompletion: number;
  quizScore: number | null;
  lookupDensity: number | null;
  timeSpentMs: number | null;
  difficultyFeedback: string | null;
  comprehensionScore: number;
  lastActivityAt: Date;
};

function toRecord(row: ArticleMasteryRow): ArticleMasteryRecord {
  return {
    articleId: row.articleId,
    readingCompletion: row.readingCompletion,
    quizScore: row.quizScore,
    lookupDensity: row.lookupDensity,
    timeSpentMs: row.timeSpentMs,
    difficultyFeedback: row.difficultyFeedback,
    comprehensionScore: row.comprehensionScore,
    lastActivityAt: row.lastActivityAt,
  };
}

function lookupDensityFor(savedCount: number, wordCount: number | null): number | null {
  return wordCount && wordCount > 0
    ? (savedCount * LOOKUP_DENSITY_WORDS) / wordCount
    : null;
}

function resolveTimeSpentMs(
  opts: { timeSpentMs?: number; accumulateTime?: boolean },
  existing: { timeSpentMs: number | null } | null,
): number | null {
  if (opts.timeSpentMs == null) return existing?.timeSpentMs ?? null;
  if (opts.accumulateTime) {
    return (existing?.timeSpentMs ?? 0) + opts.timeSpentMs;
  }
  return opts.timeSpentMs;
}

/**
 * Recomputes and upserts the user's mastery for an article from its current
 * source signals (reading progress, best quiz score, saved-word density and
 * difficulty feedback).
 *
 * `timeSpentMs` is updated only when supplied by the caller. When
 * `accumulateTime` is true the supplied delta is ADDED to the existing stored
 * value (saturating at Number.MAX_SAFE_INTEGER) instead of replacing it.
 * This lets the reading-time tracker accumulate session time without
 * over-writing concurrent updates from other sessions.
 */
export async function updateArticleMastery(
  userId: string,
  articleId: string,
  opts: { timeSpentMs?: number; accumulateTime?: boolean } = {},
): Promise<ArticleMasteryRecord | null> {
  const [progress, quizAgg, savedCount, article, feedback, existing] =
    await Promise.all([
      prisma.readingProgress.findUnique({
        where: { userId_articleId: { userId, articleId } },
        select: { percent: true },
      }),
      prisma.quizAttempt.aggregate({
        where: { userId, articleId },
        _max: { scorePct: true },
      }),
      prisma.savedWord.count({ where: { userId, articleId } }),
      prisma.article.findUnique({
        where: { id: articleId },
        select: { wordCount: true },
      }),
      prisma.articleDifficultyFeedback.findUnique({
        where: { userId_articleId: { userId, articleId } },
        select: { vote: true },
      }),
      prisma.articleMastery.findUnique({
        where: { userId_articleId: { userId, articleId } },
        select: { timeSpentMs: true },
      }),
    ]);

  const readingCompletion = clamp01((progress?.percent ?? 0) / 100);
  const bestScore = quizAgg._max.scorePct;
  const quizScore = bestScore != null ? clamp01(bestScore / 100) : null;
  const lookupDensity = lookupDensityFor(savedCount, article?.wordCount ?? null);
  const difficultyFeedback = feedback?.vote ?? null;
  const timeSpentMs = resolveTimeSpentMs(opts, existing);
  const comprehensionScore = computeComprehensionScore({
    readingCompletion,
    quizScore,
    lookupDensity,
    difficultyFeedback,
  });

  const now = new Date();
  const data = {
    readingCompletion,
    quizScore,
    lookupDensity,
    timeSpentMs,
    difficultyFeedback,
    comprehensionScore,
    lastActivityAt: now,
  };

  const row = await prisma.articleMastery.upsert({
    where: { userId_articleId: { userId, articleId } },
    create: { userId, articleId, ...data },
    update: data,
  });

  return toRecord(row as unknown as ArticleMasteryRow);
}

/** Returns the user's stored mastery for an article, or null when none. */
export async function getArticleMastery(
  userId: string,
  articleId: string,
): Promise<ArticleMasteryRecord | null> {
  const row = await prisma.articleMastery.findUnique({
    where: { userId_articleId: { userId, articleId } },
  });
  return row ? toRecord(row as unknown as ArticleMasteryRow) : null;
}
