/**
 * Review assets — turn existing highlights & notes into lightweight, optional
 * review material (#812, Today v1.1).
 *
 * @server-only — imports Prisma and the annotation command layer.
 *
 * Three privacy-conscious capabilities, all reusing existing domains:
 *
 *   1. {@link convertHighlightToReviewCard} — promote a highlight/note into a
 *      spaced-repetition review card by REUSING the existing flashcard/SRS
 *      store (`SavedWord` + SM-2). No new review-card model is introduced.
 *   2. {@link getReviewAssetSummary} — aggregate, CONTENT-FREE counts of a
 *      learner's highlights/notes for Progress/Study. Returns numbers only —
 *      never quote or note text.
 *   3. {@link recordTodayReflection} — store an optional one-sentence reflection
 *      in the EXISTING note domain (a highlight's `note`). It never touches the
 *      `TodaySession` row or analytics, so it cannot block Today completion.
 *
 * Privacy: raw selected text (a highlight's quote) and private notes live ONLY
 * in the user-owned highlight/note/flashcard domains where the learner already
 * stores them. This module NEVER writes selected text or notes into analytics
 * events or `TodaySession` metadata.
 */

import { prisma } from "@/lib/prisma";
import { updateHighlight } from "@/lib/annotations";
import { HIGHLIGHT_NOTE_MAX } from "@/lib/annotations/anchor";

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/**
 * Max length of the review-card "front" derived from a highlight quote. Capped
 * so the reused `SavedWord.word` column (and its `@@unique([userId, word])`
 * key) stays a compact, stable prompt rather than a whole paragraph. Matches
 * the 200-char `savedWordId` bound used by the study flashcard schema.
 */
export const REVIEW_CARD_FRONT_MAX = 200;

/** Max length of the stored passage context on a review card. */
export const REVIEW_CARD_CONTEXT_MAX = 1_000;

/** How many days back the "this week" highlight count window spans. */
export const REVIEW_WEEK_DAYS = 7;

// ---------------------------------------------------------------------------
// Highlight/note → review card (reuses the flashcard/SRS SavedWord store)
// ---------------------------------------------------------------------------

/** Outcome of a highlight→review-card conversion. */
export type ReviewCardConversion = {
  /** The `SavedWord` review-card id (new or pre-existing). */
  cardId: string;
  /** SRS due date — `null` means immediately due (a brand-new card). */
  dueAt: Date | null;
  /** True when a new card was created; false when an equal card already existed. */
  created: boolean;
};

/**
 * Derive a compact, stable review-card front from a highlight quote: trimmed,
 * whitespace-collapsed, and capped to {@link REVIEW_CARD_FRONT_MAX}. Used as the
 * `SavedWord.word` key so repeat conversions of the same passage are idempotent.
 */
export function reviewCardFront(quote: string): string {
  return quote.replace(/\s+/g, " ").trim().slice(0, REVIEW_CARD_FRONT_MAX);
}

/**
 * Convert one of the learner's highlights into a spaced-repetition review card
 * by reusing the existing flashcard store. The card is a `SavedWord` with the
 * highlighted passage as its front, the user's note (if any) as the back, and
 * the full passage as context; it enters the normal SM-2 review loop (a fresh
 * card has `dueAt = null`, i.e. immediately due).
 *
 * Scoped to `userId` (no IDOR): a highlight owned by another user, or a missing
 * id, returns `null`. Idempotent: converting the same passage twice returns the
 * existing card instead of creating a duplicate (and never resets its SRS
 * schedule). Optional by construction — nothing calls this unless the learner
 * explicitly asks to turn a highlight into a card.
 */
export async function convertHighlightToReviewCard(
  userId: string,
  highlightId: string,
): Promise<ReviewCardConversion | null> {
  const highlight = await prisma.highlight.findFirst({
    where: { id: highlightId, userId },
    select: { id: true, quote: true, note: true, articleId: true },
  });
  if (!highlight) return null;

  const front = reviewCardFront(highlight.quote);
  // Empty/whitespace-only quotes can't anchor a card (anchor validation already
  // forbids this at creation time, but stay defensive for legacy rows).
  if (front.length === 0) return null;

  const existing = await prisma.savedWord.findUnique({
    where: { userId_word: { userId, word: front } },
    select: { id: true, dueAt: true },
  });
  if (existing) {
    return { cardId: existing.id, dueAt: existing.dueAt, created: false };
  }

  const card = await prisma.savedWord.create({
    data: {
      userId,
      word: front,
      explanation: highlight.note ?? null,
      contextSentence: highlight.quote.slice(0, REVIEW_CARD_CONTEXT_MAX),
      articleId: highlight.articleId,
    },
    select: { id: true, dueAt: true },
  });
  return { cardId: card.id, dueAt: card.dueAt, created: true };
}

// ---------------------------------------------------------------------------
// Aggregate, content-free counts for Progress/Study
// ---------------------------------------------------------------------------

/**
 * Privacy-safe aggregate counts of a learner's highlights & notes. COUNTS ONLY
 * — no quote text, note text, or article titles are ever returned, so this is
 * safe to surface on Progress/Study and to feed (aggregate-count) analytics.
 */
export type ReviewAssetSummary = {
  /** Total highlighted passages ("saved passages"). */
  totalHighlights: number;
  /** Highlights that carry a written note. */
  notedHighlights: number;
  /** Highlights created in the last {@link REVIEW_WEEK_DAYS} days. */
  weeklyHighlights: number;
  /** Distinct articles with at least one highlight (a "themes" proxy). */
  articlesWithHighlights: number;
};

/**
 * Compute the content-free {@link ReviewAssetSummary} for a user. Every value is
 * an aggregate `count`/`groupBy` — no highlight quote or note text is loaded.
 */
export async function getReviewAssetSummary(
  userId: string,
  now: Date = new Date(),
): Promise<ReviewAssetSummary> {
  const weekStart = new Date(now.getTime() - REVIEW_WEEK_DAYS * 24 * 60 * 60 * 1000);

  const [totalHighlights, notedHighlights, weeklyHighlights, articleGroups] =
    await Promise.all([
      prisma.highlight.count({ where: { userId } }),
      prisma.highlight.count({ where: { userId, note: { not: null } } }),
      prisma.highlight.count({ where: { userId, createdAt: { gte: weekStart } } }),
      prisma.highlight.groupBy({
        by: ["articleId"],
        where: { userId },
        _count: { id: true },
      }),
    ]);

  return {
    totalHighlights,
    notedHighlights,
    weeklyHighlights,
    articlesWithHighlights: articleGroups.length,
  };
}

// ---------------------------------------------------------------------------
// Optional Today reflection bonus (stored in the existing note domain)
// ---------------------------------------------------------------------------

/** Outcome of storing a Today reflection sentence. */
export type ReflectionResult =
  | { ok: true; highlightId: string }
  | { ok: false; error: string; status: number };

/**
 * Store an optional one-sentence "after reading" reflection by writing it into
 * the EXISTING note domain — the `note` field of one of the learner's own
 * highlights (via {@link updateHighlight}, which enforces ownership). This keeps
 * the sentence in the user-owned note domain and NEVER touches the `TodaySession`
 * row, its metadata, or analytics — so it cannot block or alter required Today
 * completion. Purely additive and easy to skip.
 *
 * Returns a 404 result when the highlight doesn't exist or isn't owned by the
 * caller, and a 400 result when the sentence is empty or too long.
 */
export async function recordTodayReflection(args: {
  userId: string;
  highlightId: string;
  sentence: string;
}): Promise<ReflectionResult> {
  const sentence = args.sentence.trim();
  if (sentence.length === 0) {
    return { ok: false, error: "reflection sentence is required", status: 400 };
  }
  if (sentence.length > HIGHLIGHT_NOTE_MAX) {
    return {
      ok: false,
      error: `reflection must be at most ${HIGHLIGHT_NOTE_MAX} characters`,
      status: 400,
    };
  }

  const result = await updateHighlight(args.highlightId, args.userId, {
    note: sentence,
  });
  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status };
  }
  return { ok: true, highlightId: result.highlight.id };
}
