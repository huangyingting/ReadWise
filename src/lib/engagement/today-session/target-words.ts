/**
 * Today Session — target saved-word selection (#791).
 *
 * @server-only — imports Prisma.
 *
 * Picks a small, privacy-safe set of `SavedWord` ids for the day's short review.
 * Selection priority:
 *   1. due/never-reviewed words linked to the primary article;
 *   2. then oldest-due words across the whole vocabulary;
 *   3. then weak/recently-saved words (lowest ease, newest first) to top up.
 *
 * Only `SavedWord.id` values leave this module — never word text, explanation,
 * example, or context sentence. Selection is deterministic for a given DB state
 * (stable secondary sort on id) so repeated same-day generation is stable.
 */

import { prisma } from "@/lib/prisma";
import { TARGET_WORD_COUNT_MAX } from "./types";

/** Columns needed for ranking — deliberately excludes all word content. */
const WORD_SELECT = {
  id: true,
  articleId: true,
  dueAt: true,
  easeFactor: true,
  createdAt: true,
  lastReviewedAt: true,
} as const;

type WordRow = {
  id: string;
  articleId: string | null;
  dueAt: Date | null;
  easeFactor: number;
  createdAt: Date;
  lastReviewedAt: Date | null;
};

/** A word is "due" when it has never been reviewed or its dueAt has passed. */
function isDue(w: WordRow, now: Date): boolean {
  return w.dueAt === null || w.dueAt.getTime() <= now.getTime();
}

/** Stable comparator: oldest due first (nulls first), then oldest saved, then id. */
function byDueThenAge(a: WordRow, b: WordRow): number {
  const ad = a.dueAt ? a.dueAt.getTime() : -Infinity;
  const bd = b.dueAt ? b.dueAt.getTime() : -Infinity;
  if (ad !== bd) return ad - bd;
  const ac = a.createdAt.getTime();
  const bc = b.createdAt.getTime();
  if (ac !== bc) return ac - bc;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Stable comparator: weakest (lowest ease) first, then newest saved, then id. */
function byWeakThenRecent(a: WordRow, b: WordRow): number {
  if (a.easeFactor !== b.easeFactor) return a.easeFactor - b.easeFactor;
  const ac = a.createdAt.getTime();
  const bc = b.createdAt.getTime();
  if (ac !== bc) return bc - ac;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Result of target-word selection: ids only + the count to review. */
export type TargetWordSelection = {
  targetSavedWordIds: string[];
  reviewTargetCount: number;
};

/**
 * Select target saved-word ids for the day. Returns an empty selection (which
 * is valid) when the user has no eligible words.
 *
 * @param userId            authenticated user id (scopes every query)
 * @param primaryArticleId  the day's primary article id, or null
 * @param now               injectable clock for deterministic tests
 * @param maxCount          cap on selected ids (defaults to TARGET_WORD_COUNT_MAX)
 */
export async function selectTargetWordIds(args: {
  userId: string;
  primaryArticleId: string | null;
  now?: Date;
  maxCount?: number;
}): Promise<TargetWordSelection> {
  const {
    userId,
    primaryArticleId,
    now = new Date(),
    maxCount = TARGET_WORD_COUNT_MAX,
  } = args;

  const words = (await prisma.savedWord.findMany({
    where: { userId },
    select: WORD_SELECT,
  })) as WordRow[];

  if (words.length === 0) {
    return { targetSavedWordIds: [], reviewTargetCount: 0 };
  }

  const selected: string[] = [];
  const seen = new Set<string>();
  const push = (w: WordRow) => {
    if (seen.has(w.id) || selected.length >= maxCount) return;
    seen.add(w.id);
    selected.push(w.id);
  };

  // 1. Due/never-reviewed words linked to the primary article.
  if (primaryArticleId) {
    words
      .filter((w) => w.articleId === primaryArticleId && isDue(w, now))
      .sort(byDueThenAge)
      .forEach(push);
  }

  // 2. Oldest-due words across the whole vocabulary.
  words
    .filter((w) => isDue(w, now))
    .sort(byDueThenAge)
    .forEach(push);

  // 3. Top up with weak/recent words when not enough due words exist.
  words.sort(byWeakThenRecent).forEach(push);

  return {
    targetSavedWordIds: selected,
    reviewTargetCount: selected.length,
  };
}
