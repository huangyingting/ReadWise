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
import { clamp01 } from "@/lib/mastery";

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
  const completion = clamp01(input.readingCompletion);
  let score: number;
  if (input.quizScore != null) {
    score = 0.5 * completion + 0.5 * clamp01(input.quizScore);
  } else {
    score = completion * 0.6;
  }

  if (input.difficultyFeedback === "too_hard") {
    score *= 0.85;
  } else if (input.difficultyFeedback === "too_easy") {
    score = score * 1.05 + 0.05;
  }

  if (input.lookupDensity != null && input.lookupDensity > 0) {
    const penalty = Math.min(0.15, input.lookupDensity * 0.02);
    score *= 1 - penalty;
  }

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

/**
 * Recomputes and upserts the user's mastery for an article from its current
 * source signals (reading progress, best quiz score, saved-word density and
 * difficulty feedback). `timeSpentMs` is preserved/updated only when supplied
 * by the caller (we do not track per-article time elsewhere yet).
 */
export async function updateArticleMastery(
  userId: string,
  articleId: string,
  opts: { timeSpentMs?: number } = {},
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

  const wordCount = article?.wordCount ?? null;
  const lookupDensity =
    wordCount && wordCount > 0 ? (savedCount * 100) / wordCount : null;

  const difficultyFeedback = feedback?.vote ?? null;

  const timeSpentMs =
    opts.timeSpentMs != null ? opts.timeSpentMs : (existing?.timeSpentMs ?? null);

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
