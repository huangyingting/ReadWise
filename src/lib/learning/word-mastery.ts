/**
 * Word mastery (RW-036).
 *
 * A durable, per-user estimate of how well a user knows each WORD, keyed by a
 * normalized lemma so inflections collapse onto one row. This sits alongside
 * (never replaces) the `SavedWord` explicit study list: the user can save a
 * word for SRS, but mastery is tracked for EVERY word the user is exposed to
 * (dictionary lookups, saved words, reading) and reviews (SRS / cloze), so the
 * system can estimate familiarity even for words that were never saved.
 *
 * Scoring is intentionally transparent (no ML): `familiarity` blends raw
 * exposure (recognition) with review accuracy (recall); `confidence` reflects
 * how much evidence the estimate is based on. SRS scheduling and level/feed
 * recommendations can read these cheaply.
 */

import { prisma } from "@/lib/prisma";
import { lemmaFor } from "@/lib/lexical/normalize";
import { clamp01, parseStringArray } from "./primitives";

export { lemmaFor } from "@/lib/lexical/normalize";

/** Max source article ids retained per word (most-recent-first, bounded). */
export const MAX_SOURCE_ARTICLE_IDS = 20;

const EXPOSURE_SCORE_SATURATION = 4;
const EXPOSURE_ONLY_CEILING = 0.6;
const REVIEW_TRUST_SATURATION = 4;
const CONFIDENCE_SATURATION = 5;

export type WordMasteryRecord = {
  lemma: string;
  familiarity: number; // 0–1
  exposures: number;
  correctReviews: number;
  incorrectReviews: number;
  confidence: number; // 0–1
  sourceArticleIds: string[];
  lastSeenAt: Date;
  lastReviewedAt: Date | null;
};

/**
 * Blends exposures and review accuracy into a 0–1 familiarity score.
 *
 *   - Exposure alone (no reviews) is recognition, not recall: it saturates
 *     toward a 0.6 ceiling (≈4 exposures gives ~0.38, many exposures ~0.6).
 *   - Once review evidence exists, demonstrated recall accuracy increasingly
 *     dominates as more reviews accumulate, so a word answered correctly in
 *     SRS reads as well-known while one answered wrong is pulled back down.
 */
export function computeFamiliarity(
  exposures: number,
  correctReviews: number,
  incorrectReviews: number,
): number {
  const exposureScore = exposureRecognitionScore(exposures);
  const reviews = nonNegative(correctReviews) + nonNegative(incorrectReviews);
  if (reviews === 0) {
    return clamp01(exposureScore * EXPOSURE_ONLY_CEILING);
  }
  const accuracy = nonNegative(correctReviews) / reviews;
  const recallTrust = Math.min(1, reviews / REVIEW_TRUST_SATURATION);
  return clamp01(
    exposureScore * EXPOSURE_ONLY_CEILING * (1 - recallTrust) +
      accuracy * recallTrust,
  );
}

/**
 * How much evidence the familiarity estimate is based on (0–1). Saturates as
 * total observations (exposures + reviews) accumulate.
 */
export function computeConfidence(
  exposures: number,
  correctReviews: number,
  incorrectReviews: number,
): number {
  const evidence =
    nonNegative(exposures) +
    nonNegative(correctReviews) +
    nonNegative(incorrectReviews);
  return clamp01(1 - Math.exp(-evidence / CONFIDENCE_SATURATION));
}

function nonNegative(value: number): number {
  return Math.max(0, value);
}

function exposureRecognitionScore(exposures: number): number {
  return 1 - Math.exp(-nonNegative(exposures) / EXPOSURE_SCORE_SATURATION);
}

type WordMasteryRow = {
  lemma: string;
  familiarity: number;
  exposures: number;
  correctReviews: number;
  incorrectReviews: number;
  confidence: number;
  sourceArticleIds: unknown;
  lastSeenAt: Date;
  lastReviewedAt: Date | null;
};

function toRecord(row: WordMasteryRow): WordMasteryRecord {
  return {
    lemma: row.lemma,
    familiarity: row.familiarity,
    exposures: row.exposures,
    correctReviews: row.correctReviews,
    incorrectReviews: row.incorrectReviews,
    confidence: row.confidence,
    sourceArticleIds: parseStringArray(row.sourceArticleIds),
    lastSeenAt: row.lastSeenAt,
    lastReviewedAt: row.lastReviewedAt,
  };
}

/** Merges a new article id in at the front, deduped and bounded. */
function mergeSourceArticleIds(
  existing: string[],
  articleId: string | undefined,
): string[] {
  if (!articleId) return existing.slice(0, MAX_SOURCE_ARTICLE_IDS);
  const next = [articleId, ...existing.filter((id) => id !== articleId)];
  return next.slice(0, MAX_SOURCE_ARTICLE_IDS);
}

type WordDelta = {
  exposureDelta: number;
  correctDelta: number;
  incorrectDelta: number;
  articleId?: string;
  reviewed: boolean;
};

type WordMasteryData = {
  familiarity: number;
  exposures: number;
  correctReviews: number;
  incorrectReviews: number;
  confidence: number;
  sourceArticleIds: string[];
  lastSeenAt: Date;
  lastReviewedAt: Date | null;
};

function incrementCount(existing: number | undefined, delta: number): number {
  return (existing ?? 0) + nonNegative(delta);
}

function buildWordMasteryData(
  existing: WordMasteryRow | null,
  delta: WordDelta,
  now: Date,
): WordMasteryData {
  const exposures = incrementCount(existing?.exposures, delta.exposureDelta);
  const correctReviews = incrementCount(
    existing?.correctReviews,
    delta.correctDelta,
  );
  const incorrectReviews = incrementCount(
    existing?.incorrectReviews,
    delta.incorrectDelta,
  );
  const familiarity = computeFamiliarity(
    exposures,
    correctReviews,
    incorrectReviews,
  );
  const confidence = computeConfidence(
    exposures,
    correctReviews,
    incorrectReviews,
  );

  return {
    familiarity,
    exposures,
    correctReviews,
    incorrectReviews,
    confidence,
    sourceArticleIds: mergeSourceArticleIds(
      parseStringArray(existing?.sourceArticleIds),
      delta.articleId,
    ),
    lastSeenAt: now,
    lastReviewedAt: delta.reviewed ? now : (existing?.lastReviewedAt ?? null),
  };
}

/**
 * Reads the current row (if any), applies the delta, recomputes the derived
 * familiarity/confidence and upserts. Used by both the exposure and review
 * entry points so the scoring lives in one place. Not concurrency-perfect
 * (read-then-write) by design — mastery is eventually-consistent and updates
 * are best-effort, so a rare lost increment under heavy concurrency is fine.
 */
async function applyWordDelta(
  userId: string,
  word: string,
  delta: WordDelta,
): Promise<WordMasteryRecord | null> {
  const lemma = lemmaFor(word);
  if (!lemma) return null;

  const existing = await prisma.wordMastery.findUnique({
    where: { userId_lemma: { userId, lemma } },
  });

  const now = new Date();
  const data = buildWordMasteryData(
    existing as WordMasteryRow | null,
    delta,
    now,
  );

  const row = await prisma.wordMastery.upsert({
    where: { userId_lemma: { userId, lemma } },
    create: {
      userId,
      lemma,
      ...data,
    },
    update: data,
  });

  return toRecord(row as unknown as WordMasteryRow);
}

/**
 * Records that the user was exposed to a word (a dictionary lookup, an explicit
 * save, or a reading encounter). Increments the exposure counter and bumps
 * `lastSeenAt`; optionally records the source article.
 */
export function recordWordExposure(
  userId: string,
  word: string,
  opts: { articleId?: string } = {},
): Promise<WordMasteryRecord | null> {
  return applyWordDelta(userId, word, {
    exposureDelta: 1,
    correctDelta: 0,
    incorrectDelta: 0,
    articleId: opts.articleId,
    reviewed: false,
  });
}

/**
 * Records the outcome of a word review (SRS grade / cloze answer). A review is
 * also an exposure, so it bumps both the exposure and the correct/incorrect
 * counters and sets `lastReviewedAt`.
 */
export function recordWordReview(
  userId: string,
  word: string,
  correct: boolean,
  opts: { articleId?: string } = {},
): Promise<WordMasteryRecord | null> {
  return applyWordDelta(userId, word, {
    exposureDelta: 1,
    correctDelta: correct ? 1 : 0,
    incorrectDelta: correct ? 0 : 1,
    articleId: opts.articleId,
    reviewed: true,
  });
}

/** Returns the stored mastery record for a word, or null if never seen. */
export async function getWordMastery(
  userId: string,
  word: string,
): Promise<WordMasteryRecord | null> {
  const lemma = lemmaFor(word);
  if (!lemma) return null;
  const row = await prisma.wordMastery.findUnique({
    where: { userId_lemma: { userId, lemma } },
  });
  return row ? toRecord(row as unknown as WordMasteryRow) : null;
}

/**
 * Estimates the user's familiarity with a word (0–1) even when it is not in the
 * SavedWord study list. Returns 0 for a word with no recorded mastery.
 */
export async function estimateFamiliarity(
  userId: string,
  word: string,
): Promise<number> {
  const record = await getWordMastery(userId, word);
  return record ? record.familiarity : 0;
}
