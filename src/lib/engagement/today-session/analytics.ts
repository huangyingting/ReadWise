/**
 * Today Session — product analytics emit helpers (#802).
 *
 * @server-only — wraps the shared analytics writer (`recordEvent`) for the
 * Today funnel. These helpers are the single place Today lifecycle moments are
 * turned into metadata-only product events, so every Today emit goes through one
 * privacy-reviewed surface.
 *
 * Privacy invariant: a Today event payload carries ANCHORS, ENUMS, and COUNTS
 * ONLY — `source`, `reasonCode`, completion `tier`, the skip `reasonCode`,
 * booleans, and small counts. It MUST NEVER contain article titles, article
 * text, selected text, word text, definitions, examples, context sentences,
 * prompts, notes, tokens, or PII. `userId`/`articleId`/`sessionId` are the
 * writer's plain (non-FK) id anchors.
 *
 * Best-effort: `recordEvent` never throws and is a no-op when analytics is
 * disabled, so these helpers can be awaited inline without ever breaking the
 * user action that emitted them.
 */

import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import type { TodaySessionView } from "./types";

/** How the reading step was completed: progress threshold vs manual fallback. */
export type TodayReadingMethod = "auto" | "manual";

/** Shared id anchors pulled from a session view (ids only — never content). */
function sessionAnchors(session: TodaySessionView): {
  userId: string;
  articleId: string | null;
  sessionId: string;
} {
  return {
    userId: session.userId,
    articleId: session.primaryArticleId,
    sessionId: session.id,
  };
}

/**
 * A Today session was freshly generated for a local day. Fires once per day on
 * first creation (not on idempotent re-reads). Metadata: how the primary was
 * chosen, the diagnostic reason code, and plan sizes (counts only).
 */
export function emitTodaySessionGenerated(
  session: TodaySessionView,
): Promise<void> {
  return recordEvent({
    type: ANALYTICS_EVENT_TYPES.todaySessionGenerated,
    ...sessionAnchors(session),
    properties: {
      source: session.source,
      reasonCode: session.generationReasonCode,
      hasPrimary: session.primaryArticleId != null,
      backupCount: session.backupArticleIds.length,
      targetWordCount: session.targetSavedWordIds.length,
      reviewTargetCount: session.reviewTargetCount,
    },
  });
}

/**
 * A no-candidate day was generated — the learner is shown the browse/import
 * prompt instead of a primary article. Complements `today_session_generated`
 * for the "no article today" funnel branch.
 */
export function emitTodayNoCandidate(session: TodaySessionView): Promise<void> {
  return recordEvent({
    type: ANALYTICS_EVENT_TYPES.todayNoCandidate,
    ...sessionAnchors(session),
    properties: {
      source: session.source,
      reasonCode: session.generationReasonCode,
    },
  });
}

/**
 * The learner viewed their Today session (page render or summary fetch).
 * Metadata: lifecycle status, source, completion tier, and presence flags so
 * time-to-view and view→completion can be computed.
 */
export function emitTodaySessionViewed(
  session: TodaySessionView,
): Promise<void> {
  return recordEvent({
    type: ANALYTICS_EVENT_TYPES.todaySessionViewed,
    ...sessionAnchors(session),
    properties: {
      status: session.status,
      source: session.source,
      tier: session.completionTier,
      hasPrimary: session.primaryArticleId != null,
      isNoCandidate: session.primaryArticleId == null,
      skipped: session.skipped,
    },
  });
}

/**
 * The Today reading step first completed. `method` distinguishes a progress
 * threshold crossing (`auto`) from the manual "mark reading done" fallback
 * (`manual`). `tier` is the recomputed completion tier after the transition.
 */
export function emitTodayReadingComplete(
  session: TodaySessionView,
  method: TodayReadingMethod,
): Promise<void> {
  return recordEvent({
    type: ANALYTICS_EVENT_TYPES.todayReadingComplete,
    ...sessionAnchors(session),
    properties: {
      method,
      tier: session.completionTier,
      hasTargetWords: session.targetSavedWordIds.length > 0,
    },
  });
}

/** The Today comprehension step first completed (quiz / difficulty signal). */
export function emitTodayComprehensionComplete(
  session: TodaySessionView,
): Promise<void> {
  return recordEvent({
    type: ANALYTICS_EVENT_TYPES.todayComprehensionComplete,
    ...sessionAnchors(session),
    properties: {
      tier: session.completionTier,
    },
  });
}

/**
 * The Today word-review step first completed. `targetCount` is the effective
 * number of resolvable target words that had to be reviewed (a COUNT, never the
 * words themselves).
 */
export function emitTodayWordReviewComplete(
  session: TodaySessionView,
  targetCount: number,
): Promise<void> {
  return recordEvent({
    type: ANALYTICS_EVENT_TYPES.todayWordReviewComplete,
    ...sessionAnchors(session),
    properties: {
      tier: session.completionTier,
      targetCount,
    },
  });
}

/**
 * The whole Today session first transitioned to `completed`. `tier` is the best
 * available tier reached; `hadTargetWords` records whether the day required a
 * word-review step to reach `full`.
 */
export function emitTodaySessionComplete(
  session: TodaySessionView,
  hadTargetWords: boolean,
): Promise<void> {
  return recordEvent({
    type: ANALYTICS_EVENT_TYPES.todaySessionComplete,
    ...sessionAnchors(session),
    properties: {
      tier: session.completionTier,
      source: session.source,
      hadTargetWords,
    },
  });
}

/**
 * The learner skipped Today with a controlled reason code. Metadata: the
 * controlled `reasonCode`, whether the daily skip limit was already reached, the
 * browse-fallback flag, and the backup count (counts/enums/flags only).
 */
export function emitTodaySkip(
  session: TodaySessionView,
  args: { limitReached: boolean; browseFallback: boolean },
): Promise<void> {
  return recordEvent({
    type: ANALYTICS_EVENT_TYPES.todaySkip,
    ...sessionAnchors(session),
    properties: {
      reasonCode: session.skipReason,
      limitReached: args.limitReached,
      browseFallback: args.browseFallback,
      backupCount: session.backupArticleIds.length,
    },
  });
}
