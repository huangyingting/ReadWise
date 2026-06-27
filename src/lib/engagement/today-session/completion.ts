/**
 * Today Session — completion tier engine + best-available completion (#792,
 * #793, #794, #795).
 *
 * @server-only — the marker commands import Prisma (via the repository and a
 * privacy-safe `SavedWord` review lookup). The pure tier logic at the top of
 * this file has NO I/O and is unit-tested in isolation.
 *
 * Today is NOT the source of truth for reading/quiz/review facts; it only wires
 * those existing facts into step completion. The marker commands:
 *   - only ever act on the learner's CURRENT primary article / target words;
 *   - are idempotent — repeated calls never overwrite an earlier completion
 *     timestamp and never downgrade a completed session;
 *   - persist anchors/ids/timestamps/flags ONLY — never article text, word
 *     text, definitions, examples, context sentences, prompts, or notes.
 *
 * "Best available" completion: a day completes at the best tier it can actually
 * reach. With target words, that is `full` (reading + comprehension + review);
 * with no (resolvable) target words, `comprehension` is the best available tier
 * and completes the session on its own.
 */

import { prisma } from "@/lib/prisma";
import {
  getTodaySession,
  updateTodaySession,
  type TodaySessionUpdate,
} from "./repository";
import { resolveLocalDate } from "./local-date";
import { TARGET_WORD_COUNT_MIN } from "./types";
import {
  emitTodayComprehensionComplete,
  emitTodayReadingComplete,
  emitTodaySessionComplete,
  emitTodayWordReviewComplete,
  type TodayReadingMethod,
} from "./analytics";
import type {
  TodayCompletionTier,
  TodaySessionStatus,
  TodaySessionView,
} from "./types";

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/**
 * Scroll percent at/above which reading is considered complete. Mirrors
 * `COMPLETION_THRESHOLD` in `@/lib/engagement/progress` — kept as a local const
 * so the pure threshold check stays dependency-light and unit-testable.
 */
export const READING_COMPLETION_PERCENT = 95;

/**
 * Word-review threshold: when `≤ WORD_REVIEW_ALL_AT_MOST` resolvable target
 * words exist, ALL of them must be reviewed; otherwise at least
 * `WORD_REVIEW_LARGE_THRESHOLD` of them must be reviewed.
 */
export const WORD_REVIEW_ALL_AT_MOST = TARGET_WORD_COUNT_MIN; // 3
export const WORD_REVIEW_LARGE_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Pure tier logic (no I/O)
// ---------------------------------------------------------------------------

/** Which completion dimensions are satisfied, plus whether targets exist. */
export type CompletionInputs = {
  reading: boolean;
  comprehension: boolean;
  wordReview: boolean;
  /** True when the session has at least one resolvable target saved word. */
  hasTargetWords: boolean;
};

/** Monotonic ordering of tiers so a recompute never downgrades a session. */
const TIER_RANK: Record<TodayCompletionTier, number> = {
  none: 0,
  reading: 1,
  comprehension: 2,
  full: 3,
};

/**
 * Compute the completion tier from the satisfied dimensions.
 *
 *   - `none`          — reading not yet complete.
 *   - `reading`       — reading complete only.
 *   - `comprehension` — reading + comprehension complete (the "standard" tier).
 *   - `full`          — reading + comprehension + word review, when target
 *                       words exist. With no target words, `comprehension` is
 *                       the best available tier and `full` is never required.
 */
export function computeCompletionTier(i: CompletionInputs): TodayCompletionTier {
  if (!i.reading) return "none";
  if (!i.comprehension) return "reading";
  if (i.hasTargetWords) return i.wordReview ? "full" : "comprehension";
  return "comprehension";
}

/**
 * True when the session has reached its BEST AVAILABLE tier and should be
 * marked `completed`. Requires reading + comprehension always; requires word
 * review only when target words exist.
 */
export function isBestAvailableComplete(i: CompletionInputs): boolean {
  if (!i.reading || !i.comprehension) return false;
  if (i.hasTargetWords) return i.wordReview;
  return true;
}

/** Current persisted completion state a decision is derived against. */
export type CurrentCompletion = {
  completionTier: TodayCompletionTier;
  status: TodaySessionStatus;
  completedAt: Date | null;
};

/** The next completion state, plus whether it differs from the current one. */
export type CompletionDecision = {
  completionTier: TodayCompletionTier;
  status: TodaySessionStatus;
  completedAt: Date | null;
  changed: boolean;
};

/**
 * Derive the next completion state from the current state + satisfied
 * dimensions. Pure and monotonic:
 *   - the tier never downgrades below the current tier;
 *   - a `completed` session stays completed and keeps its original
 *     `completedAt`;
 *   - a `skipped` session is left untouched (skip is a separate lifecycle).
 */
export function deriveCompletionState(
  current: CurrentCompletion,
  inputs: CompletionInputs,
  now: Date,
): CompletionDecision {
  if (current.status === "skipped") {
    return {
      completionTier: current.completionTier,
      status: "skipped",
      completedAt: current.completedAt,
      changed: false,
    };
  }

  const computed = computeCompletionTier(inputs);
  const completionTier =
    TIER_RANK[computed] >= TIER_RANK[current.completionTier]
      ? computed
      : current.completionTier;

  const complete =
    current.status === "completed" || isBestAvailableComplete(inputs);
  const status: TodaySessionStatus = complete ? "completed" : current.status;
  const completedAt = current.completedAt ?? (complete ? now : null);

  const changed =
    completionTier !== current.completionTier ||
    status !== current.status ||
    (completedAt?.getTime() ?? null) !== (current.completedAt?.getTime() ?? null);

  return { completionTier, status, completedAt, changed };
}

// ---------------------------------------------------------------------------
// Recompute + persist (server-only)
// ---------------------------------------------------------------------------

/**
 * Re-evaluate every completion dimension for an existing session and persist
 * the resulting tier/status/completedAt (and the word-review timestamp when it
 * first completes). Returns the (possibly updated) session view, or `null` when
 * no session exists for `(userId, localDate)`.
 *
 * The word-review dimension is recomputed from `SavedWord.lastReviewedAt`
 * against the session's `createdAt` evidence window. Target words deleted or
 * otherwise inaccessible since selection simply drop out of the lookup and are
 * skipped gracefully — the effective target count shrinks rather than crashing.
 */
export async function recomputeTodayCompletion(
  userId: string,
  localDate: string,
  now: Date = new Date(),
): Promise<TodaySessionView | null> {
  const session = await getTodaySession(userId, localDate);
  if (!session) return null;
  if (session.status === "skipped") return session;

  let hasTargetWords = false;
  let reviewMet = false;
  let effectiveTargetCount = 0;
  if (session.targetSavedWordIds.length > 0) {
    // ids + review timestamp ONLY — never word text or definitions.
    const rows = await prisma.savedWord.findMany({
      where: { userId, id: { in: session.targetSavedWordIds } },
      select: { id: true, lastReviewedAt: true },
    });
    const effectiveCount = rows.length; // deleted/inaccessible targets drop out
    effectiveTargetCount = effectiveCount;
    hasTargetWords = effectiveCount > 0;
    if (effectiveCount > 0) {
      const windowStart = session.createdAt.getTime();
      const reviewedCount = rows.filter(
        (r) => r.lastReviewedAt != null && r.lastReviewedAt.getTime() >= windowStart,
      ).length;
      const threshold =
        effectiveCount <= WORD_REVIEW_ALL_AT_MOST
          ? effectiveCount
          : WORD_REVIEW_LARGE_THRESHOLD;
      reviewMet = reviewedCount >= threshold;
    }
  }

  // Word-review completion is sticky once reached.
  const nextWordReviewCompletedAt =
    session.wordReviewCompletedAt ?? (reviewMet ? now : null);
  const wordReviewDone =
    session.wordReviewCompletedAt != null || reviewMet;

  const inputs: CompletionInputs = {
    reading: session.readingCompletedAt != null,
    comprehension: session.comprehensionCompletedAt != null,
    wordReview: wordReviewDone,
    hasTargetWords,
  };

  const decision = deriveCompletionState(
    {
      completionTier: session.completionTier,
      status: session.status,
      completedAt: session.completedAt,
    },
    inputs,
    now,
  );

  const update: TodaySessionUpdate = {};
  let changed = false;

  if (
    (nextWordReviewCompletedAt?.getTime() ?? null) !==
    (session.wordReviewCompletedAt?.getTime() ?? null)
  ) {
    update.wordReviewCompletedAt = nextWordReviewCompletedAt;
    changed = true;
  }
  if (decision.changed) {
    update.completionTier = decision.completionTier;
    update.status = decision.status;
    update.completedAt = decision.completedAt;
    changed = true;
  }

  if (!changed) return session;
  const updated = await updateTodaySession(userId, localDate, update);

  // Product analytics (#802): emit step/session completion the first time each
  // milestone is reached. Best-effort + metadata only (tier/counts/flags). The
  // word-review and whole-session transitions are detected here because they
  // can fall out of ANY recompute (reading, comprehension, or review markers).
  const view = updated ?? session;
  const wordReviewFirstComplete =
    session.wordReviewCompletedAt == null && nextWordReviewCompletedAt != null;
  const sessionFirstComplete =
    session.status !== "completed" && decision.status === "completed";
  if (wordReviewFirstComplete) {
    await emitTodayWordReviewComplete(view, effectiveTargetCount);
  }
  if (sessionFirstComplete) {
    await emitTodaySessionComplete(view, hasTargetWords);
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Marker commands
// ---------------------------------------------------------------------------

type MarkArgs = {
  userId: string;
  now?: Date;
  requestTimezone?: string | null;
};

/**
 * Mark today's reading step complete for `articleId`. No-op (returns `null`)
 * when there is no Today session for the learner's local day, or when
 * `articleId` is not the session's current primary article — only the current
 * primary article can complete the Today reading step. Idempotent: an existing
 * `readingCompletedAt` is never overwritten. This NEVER touches `ReadingProgress`.
 */
export async function markTodayReadingComplete(
  args: MarkArgs & { userId: string; articleId: string },
): Promise<TodaySessionView | null> {
  const now = args.now ?? new Date();
  const { localDate } = await resolveLocalDate({
    userId: args.userId,
    requestTimezone: args.requestTimezone,
    now,
  });
  const session = await getTodaySession(args.userId, localDate);
  if (!session) return null;
  if (!session.primaryArticleId || session.primaryArticleId !== args.articleId) {
    return null;
  }
  const wasComplete = session.readingCompletedAt != null;
  if (!wasComplete) {
    await updateTodaySession(args.userId, localDate, { readingCompletedAt: now });
  }
  const view = await recomputeTodayCompletion(args.userId, localDate, now);
  if (!wasComplete && view) await emitTodayReadingComplete(view, "auto");
  return view;
}

/**
 * Manual Today-only reading-completion fallback. Completes the reading step for
 * the session's CURRENT primary article without inspecting (or mutating)
 * `ReadingProgress`, so a learner can mark the day's article read even when
 * scroll progress never crossed the threshold (e.g. offline, printed, or
 * screen-reader reading). No-op (returns `null`) when there is no Today session
 * or the day has no primary article. Idempotent.
 */
export async function markTodayReadingCompleteManual(
  args: MarkArgs,
): Promise<TodaySessionView | null> {
  const now = args.now ?? new Date();
  const { localDate } = await resolveLocalDate({
    userId: args.userId,
    requestTimezone: args.requestTimezone,
    now,
  });
  const session = await getTodaySession(args.userId, localDate);
  if (!session || !session.primaryArticleId) return null;
  const wasComplete = session.readingCompletedAt != null;
  if (!wasComplete) {
    await updateTodaySession(args.userId, localDate, { readingCompletedAt: now });
  }
  const view = await recomputeTodayCompletion(args.userId, localDate, now);
  if (!wasComplete && view) await emitTodayReadingComplete(view, "manual");
  return view;
}
export async function syncTodayReadingFromProgress(args: {
  userId: string;
  articleId: string;
  percent: number;
  completed: boolean;
  now?: Date;
  requestTimezone?: string | null;
}): Promise<TodaySessionView | null> {
  if (!args.completed && args.percent < READING_COMPLETION_PERCENT) return null;
  return markTodayReadingComplete({
    userId: args.userId,
    articleId: args.articleId,
    now: args.now,
    requestTimezone: args.requestTimezone,
  });
}

/**
 * Mark today's comprehension step complete for `articleId`. Driven by an
 * existing quiz attempt or difficulty-feedback action on the primary article,
 * or by the lightweight comprehension self-check (#807) — in which case the
 * controlled `selfRating` is threaded into the completion analytics. Self-rating
 * ALONE is sufficient to advance `comprehensionCompletedAt`; no full quiz is
 * required. No-op when there is no Today session or `articleId` is not the
 * current primary article. Idempotent: an existing `comprehensionCompletedAt` is
 * never overwritten.
 */
export async function markTodayComprehensionComplete(
  args: MarkArgs & { userId: string; articleId: string; selfRating?: string | null },
): Promise<TodaySessionView | null> {
  const now = args.now ?? new Date();
  const { localDate } = await resolveLocalDate({
    userId: args.userId,
    requestTimezone: args.requestTimezone,
    now,
  });
  const session = await getTodaySession(args.userId, localDate);
  if (!session) return null;
  if (!session.primaryArticleId || session.primaryArticleId !== args.articleId) {
    return null;
  }
  const wasComplete = session.comprehensionCompletedAt != null;
  if (!wasComplete) {
    await updateTodaySession(args.userId, localDate, {
      comprehensionCompletedAt: now,
    });
  }
  const view = await recomputeTodayCompletion(args.userId, localDate, now);
  if (!wasComplete && view) await emitTodayComprehensionComplete(view, args.selfRating);
  return view;
}

/**
 * Recompute today's word-review step after a flashcard grade. The review step
 * completes when enough of the session's target saved words have been reviewed
 * within the day's evidence window (see {@link recomputeTodayCompletion}).
 * No-op when there is no Today session for the learner's local day. Idempotent.
 */
export async function markTodayWordReviewComplete(
  args: MarkArgs,
): Promise<TodaySessionView | null> {
  const now = args.now ?? new Date();
  const { localDate } = await resolveLocalDate({
    userId: args.userId,
    requestTimezone: args.requestTimezone,
    now,
  });
  const session = await getTodaySession(args.userId, localDate);
  if (!session) return null;
  return recomputeTodayCompletion(args.userId, localDate, now);
}
