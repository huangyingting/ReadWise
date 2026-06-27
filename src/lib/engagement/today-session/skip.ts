/**
 * Today Session — skip lifecycle (#797).
 *
 * @server-only — imports Prisma (via the generator + repository).
 *
 * Skipping is a per-local-day, controlled-reason action. It is deliberately a
 * LIFECYCLE transition, not a plan mutation: P1 keeps the day's generated plan
 * (primary + backups) immutable so every same-day load is idempotent. Skip
 * therefore:
 *   - validates a controlled {@link TodaySkipReason} before any write;
 *   - marks the day `skipped` (status + flag + reason + timestamp);
 *   - records the dismissed primary article id by appending it to the stable
 *     backup list (ids only — never content) so it is retained as a
 *     dismissed-but-known anchor without duplicating an already-present id;
 *   - surfaces the day's stable backup ids in the result so the UI can offer a
 *     graceful browse fallback ("here's what you could read instead").
 *
 * Daily skip limit: a day can be skipped once. A second skip (or skipping an
 * already-completed day) is a no-op that reports `limitReached: true` with the
 * browse fallback, rather than throwing — so the client stays graceful.
 *
 * NOTE: per-article promotion that swaps in a backup as the new active primary
 * (keeping the day going) needs durable dismissed-id tracking and is a
 * documented follow-up; v1 skip ends the day and points the learner at browse.
 */

import { getOrCreateTodaySession } from "./generator";
import { updateTodaySession } from "./repository";
import { resolveLocalDate } from "./local-date";
import { assertControlledValue, TODAY_SKIP_REASONS } from "./types";
import type { TodaySkipReason, TodaySessionView } from "./types";

/** Maximum number of skips allowed for a single local day. */
export const TODAY_DAILY_SKIP_LIMIT = 1;

/** Outcome of a {@link skipTodaySession} call. */
export type SkipResult = {
  /** The (possibly updated) session view after the skip attempt. */
  session: TodaySessionView;
  /** True when THIS call transitioned the day into the skipped state. */
  skipped: boolean;
  /** True when no skip was available (already skipped/completed today). */
  limitReached: boolean;
  /** True when the learner has no active primary article and should browse. */
  browseFallback: boolean;
  /** Stable backup article ids surfaced for the browse fallback (ids only). */
  promotedBackupIds: string[];
};

/**
 * Skip the learner's Today session for their local day.
 *
 * Always scoped to the authenticated `userId` (never a body-supplied id). The
 * session is created on demand if the learner has not loaded `/today` yet, so a
 * skip is well-defined even on first contact. Idempotent: skipping an
 * already-skipped or completed day reports `limitReached` without re-writing.
 */
export async function skipTodaySession(args: {
  userId: string;
  skipReason: TodaySkipReason;
  requestTimezone?: string | null;
  now?: Date;
}): Promise<SkipResult> {
  const now = args.now ?? new Date();

  // Reject an invalid controlled reason BEFORE any read/write (fail closed).
  const skipReason = assertControlledValue(
    TODAY_SKIP_REASONS,
    args.skipReason,
    "skipReason",
  );

  const { localDate, timezone } = await resolveLocalDate({
    userId: args.userId,
    requestTimezone: args.requestTimezone,
    now,
  });

  const session = await getOrCreateTodaySession({
    userId: args.userId,
    localDate,
    timezoneSnapshot: timezone,
    now,
  });

  // Skip limit reached: a day already skipped or already completed cannot be
  // skipped again. Report gracefully with the browse fallback.
  if (session.status === "skipped" || session.status === "completed") {
    return {
      session,
      skipped: false,
      limitReached: true,
      browseFallback: session.status === "skipped",
      promotedBackupIds: session.backupArticleIds,
    };
  }

  // Retain the dismissed primary id as a known anchor (ids only) without
  // duplicating an id already present in the stable backup list.
  const dismissedId = session.primaryArticleId;
  const nextBackupIds =
    dismissedId && !session.backupArticleIds.includes(dismissedId)
      ? [...session.backupArticleIds, dismissedId]
      : session.backupArticleIds;

  const updated = await updateTodaySession(args.userId, localDate, {
    status: "skipped",
    skipped: true,
    skipReason,
    skippedAt: now,
    backupArticleIds: nextBackupIds,
  });

  // `updateMany` matched the owning row (we just created/loaded it); fall back
  // to the loaded view defensively if a concurrent delete raced us.
  const result = updated ?? session;

  return {
    session: result,
    skipped: updated != null,
    limitReached: false,
    browseFallback: true,
    promotedBackupIds: session.backupArticleIds,
  };
}
