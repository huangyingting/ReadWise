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
import { normalizeCandidates } from "@/lib/lexical/normalize";
import { clamp01, parseStringArray } from "@/lib/mastery";

/** Max source article ids retained per word (most-recent-first, bounded). */
export const MAX_SOURCE_ARTICLE_IDS = 20;

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
 * Normalizes a raw word/token to a canonical lemma key. Reuses the dictionary
 * lemmatizer's first (surface-normalized) candidate so the lemma is consistent
 * across every call site (lowercased, contraction-expanded, possessive- and
 * punctuation-stripped). Returns "" for tokens with no alphabetic content.
 *
 * Note: this deliberately uses the first candidate (never an over-reduced stem)
 * so a lemma is always a real surface form — case/possessive variants merge,
 * while aggressive inflection-merging is left to the dictionary's resolved base
 * form. It never produces a garbage key.
 */
export function lemmaFor(word: string): string {
  const candidates = normalizeCandidates(word);
  if (candidates.length > 0) return candidates[0];
  return word.toLowerCase().trim();
}

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
  const exposureScore = 1 - Math.exp(-Math.max(0, exposures) / 4); // 0 → ~1
  const reviews = Math.max(0, correctReviews) + Math.max(0, incorrectReviews);
  if (reviews === 0) {
    return clamp01(exposureScore * 0.6);
  }
  const accuracy = Math.max(0, correctReviews) / reviews;
  const recallTrust = Math.min(1, reviews / 4);
  return clamp01(exposureScore * 0.6 * (1 - recallTrust) + accuracy * recallTrust);
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
    Math.max(0, exposures) +
    Math.max(0, correctReviews) +
    Math.max(0, incorrectReviews);
  return clamp01(1 - Math.exp(-evidence / 5));
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
  const exposures =
    (existing?.exposures ?? 0) + Math.max(0, delta.exposureDelta);
  const correctReviews =
    (existing?.correctReviews ?? 0) + Math.max(0, delta.correctDelta);
  const incorrectReviews =
    (existing?.incorrectReviews ?? 0) + Math.max(0, delta.incorrectDelta);

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

  const sourceArticleIds = mergeSourceArticleIds(
    parseStringArray(existing?.sourceArticleIds),
    delta.articleId,
  );

  const lastReviewedAt = delta.reviewed
    ? now
    : (existing?.lastReviewedAt ?? null);

  const row = await prisma.wordMastery.upsert({
    where: { userId_lemma: { userId, lemma } },
    create: {
      userId,
      lemma,
      familiarity,
      exposures,
      correctReviews,
      incorrectReviews,
      confidence,
      sourceArticleIds,
      lastSeenAt: now,
      lastReviewedAt,
    },
    update: {
      familiarity,
      exposures,
      correctReviews,
      incorrectReviews,
      confidence,
      sourceArticleIds,
      lastSeenAt: now,
      lastReviewedAt,
    },
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
