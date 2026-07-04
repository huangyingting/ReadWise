/**
 * Flashcard helpers for the SM-2 spaced-repetition study loop (US-M6).
 *
 * getDueFlashcards — returns cards due for review (dueAt <= now OR never reviewed).
 * gradeFlashcard   — applies the SRS schedule update and persists it.
 * getReviewSummary — counts due cards and total saved words.
 */

import { prisma } from "@/lib/prisma";
import { applySm2, type Grade } from "./srs";
import { recordWordReview } from "./word-mastery";
import { recordSkillEvidence } from "./skill-mastery";
import { bestEffortMastery } from "./primitives";

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

const FLASHCARD_SELECT = {
  id: true,
  word: true,
  explanation: true,
  example: true,
  contextSentence: true,
  articleId: true,
} as const;

type FlashcardQueueRow = FlashcardView & {
  dueAt: Date | null;
  createdAt: Date;
};

function dueSavedWordWhere(userId: string, now: Date) {
  return {
    userId,
    OR: [{ dueAt: null }, { dueAt: { lte: now } }],
  };
}

function toFlashcardView(card: FlashcardView): FlashcardView {
  return {
    id: card.id,
    word: card.word,
    explanation: card.explanation,
    example: card.example,
    contextSentence: card.contextSentence,
    articleId: card.articleId,
  };
}

function interleaveDueAndNew(
  overdue: FlashcardQueueRow[],
  fresh: FlashcardQueueRow[],
  limit: number,
): FlashcardQueueRow[] {
  const result: FlashcardQueueRow[] = [];
  let overdueIndex = 0;
  let freshIndex = 0;

  while (result.length < limit && (overdueIndex < overdue.length || freshIndex < fresh.length)) {
    for (let i = 0; i < 2 && result.length < limit && overdueIndex < overdue.length; i++) {
      result.push(overdue[overdueIndex++]);
    }
    if (result.length < limit && freshIndex < fresh.length) {
      result.push(fresh[freshIndex++]);
    }
    if (overdueIndex >= overdue.length) {
      while (result.length < limit && freshIndex < fresh.length) {
        result.push(fresh[freshIndex++]);
      }
    }
    if (freshIndex >= fresh.length) {
      while (result.length < limit && overdueIndex < overdue.length) {
        result.push(overdue[overdueIndex++]);
      }
    }
  }

  return result;
}

/**
 * Returns up to `limit` flashcards that are due for review.
 * Past-due reviews and new cards (`dueAt = null`) are both due, but the queue
 * uses a deterministic 2 overdue : 1 new mix (then fills from the remaining
 * side) so large import batches cannot starve reviews and review backlogs still
 * introduce new cards.
 */
export async function getDueFlashcards(
  userId: string,
  limit = 20,
): Promise<FlashcardView[]> {
  const now = new Date();
  const take = Math.max(0, Math.trunc(limit));
  if (take === 0) return [];

  const select = { ...FLASHCARD_SELECT, dueAt: true, createdAt: true } as const;
  const [overdue, fresh] = await Promise.all([
    prisma.savedWord.findMany({
      where: { userId, dueAt: { lte: now } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take,
      select,
    }),
    prisma.savedWord.findMany({
      where: { userId, dueAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take,
      select,
    }),
  ]);

  return interleaveDueAndNew(overdue, fresh, take).map(toFlashcardView);
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
      where: dueSavedWordWhere(userId, now),
    }),
    prisma.savedWord.count({ where: { userId } }),
  ]);
  return { dueCount, totalSaved };
}
