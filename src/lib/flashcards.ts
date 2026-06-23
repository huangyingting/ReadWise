/**
 * Flashcard helpers for the SM-2 spaced-repetition study loop (US-M6).
 *
 * getDueFlashcards — returns cards due for review (dueAt <= now OR never reviewed).
 * gradeFlashcard   — applies the SRS schedule update and persists it.
 * getReviewSummary — counts due cards and total saved words.
 */

import { prisma } from "@/lib/prisma";
import { applySm2, type Grade } from "@/lib/srs";
import { recordWordReview } from "@/lib/word-mastery";
import { recordSkillEvidence } from "@/lib/skill-mastery";
import { bestEffortMastery } from "@/lib/mastery";

export type FlashcardView = {
  id: string;
  word: string;
  explanation: string | null;
  example: string | null;
  contextSentence: string | null;
  articleId: string | null;
};

export type GradeResult = {
  dueAt: Date | null;
  intervalDays: number;
};

export type ReviewSummary = {
  dueCount: number;
  totalSaved: number;
};

/**
 * Maps an SM-2 grade to a 0–1 vocabulary-skill outcome. Mirrors the recall
 * quality: a confident "easy" is full credit; "again" is none.
 */
const GRADE_OUTCOME: Record<Grade, number> = {
  again: 0,
  hard: 0.35,
  good: 0.75,
  easy: 1,
};

/**
 * Returns up to `limit` flashcards that are due for review.
 * Cards with dueAt = null (never reviewed) are treated as immediately due and
 * come first; remaining slots are filled by oldest-due first.
 */
export async function getDueFlashcards(
  userId: string,
  limit = 20,
): Promise<FlashcardView[]> {
  const now = new Date();
  const cards = await prisma.savedWord.findMany({
    where: {
      userId,
      OR: [{ dueAt: null }, { dueAt: { lte: now } }],
    },
    // SQLite sorts NULLs before non-NULLs in ASC order → new cards appear first
    orderBy: { dueAt: "asc" },
    take: limit,
    select: { id: true, word: true, explanation: true, example: true, contextSentence: true, articleId: true },
  });

  return cards.map((c) => ({
    id: c.id,
    word: c.word,
    explanation: c.explanation,
    example: c.example,
    contextSentence: c.contextSentence,
    articleId: c.articleId,
  }));
}

/**
 * Applies an SM-2 grade to a flashcard and persists the new schedule.
 * Returns null when the card doesn't exist or doesn't belong to the user.
 */
export async function gradeFlashcard(
  userId: string,
  savedWordId: string,
  grade: Grade,
): Promise<GradeResult | null> {
  const card = await prisma.savedWord.findUnique({
    where: { id: savedWordId },
    select: {
      id: true,
      userId: true,
      word: true,
      articleId: true,
      intervalDays: true,
      easeFactor: true,
      repetitions: true,
    },
  });

  if (!card || card.userId !== userId) return null;

  const next = applySm2(
    {
      intervalDays: card.intervalDays,
      easeFactor: card.easeFactor,
      repetitions: card.repetitions,
    },
    grade,
  );

  await prisma.savedWord.update({
    where: { id: savedWordId },
    data: {
      dueAt: next.dueAt,
      intervalDays: next.intervalDays,
      easeFactor: next.easeFactor,
      repetitions: next.repetitions,
      lastReviewedAt: new Date(),
    },
  });

  // Best-effort mastery — a flashcard review is a vocabulary review signal. A
  // "good"/"easy" recall counts as correct; "again"/"hard" as incorrect. Never
  // break the SRS write if mastery bookkeeping fails.
  const correct = grade === "good" || grade === "easy";
  const skillOutcome = GRADE_OUTCOME[grade];
  await Promise.all([
    bestEffortMastery("flashcard.word_review", () =>
      recordWordReview(userId, card.word, correct, {
        articleId: card.articleId ?? undefined,
      }),
    ),
    bestEffortMastery("flashcard.vocabulary_skill", () =>
      recordSkillEvidence(userId, "vocabulary", skillOutcome),
    ),
  ]);

  return { dueAt: next.dueAt, intervalDays: next.intervalDays };
}

/** Counts how many flashcards are currently due and the user's total saved words. */
export async function getReviewSummary(userId: string): Promise<ReviewSummary> {
  const now = new Date();
  const [dueCount, totalSaved] = await Promise.all([
    prisma.savedWord.count({
      where: {
        userId,
        OR: [{ dueAt: null }, { dueAt: { lte: now } }],
      },
    }),
    prisma.savedWord.count({ where: { userId } }),
  ]);
  return { dueCount, totalSaved };
}
