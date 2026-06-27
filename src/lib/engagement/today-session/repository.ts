/**
 * Today Session — user-scoped repository helpers (#789).
 *
 * @server-only — imports Prisma.
 *
 * Every helper scopes by the authenticated `userId` passed in by the caller.
 * A user id is NEVER read from a request body here; callers must pass the id
 * from the verified session. Controlled string columns are validated before any
 * write so an invalid status/source/tier/reason fails closed (never persisted).
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  TODAY_SESSION_STATUSES,
  TODAY_SESSION_SOURCES,
  TODAY_COMPLETION_TIERS,
  TODAY_GENERATION_REASON_CODES,
  TODAY_SKIP_REASONS,
  assertControlledValue,
  isTodaySessionStatus,
  isTodaySessionSource,
  isTodayCompletionTier,
  isTodayGenerationReasonCode,
  isTodaySkipReason,
  toIdArray,
  type TodaySessionPlan,
  type TodaySessionView,
} from "./types";

/** Minimal row shape the mapper needs (matches the Prisma TodaySession model). */
type TodaySessionRow = {
  id: string;
  userId: string;
  localDate: string;
  timezoneSnapshot: string;
  primaryArticleId: string | null;
  backupArticleIds: Prisma.JsonValue;
  targetSavedWordIds: Prisma.JsonValue;
  reviewTargetCount: number;
  status: string;
  source: string;
  completionTier: string;
  generationReasonCode: string;
  readingCompletedAt: Date | null;
  comprehensionCompletedAt: Date | null;
  wordReviewCompletedAt: Date | null;
  completedAt: Date | null;
  skipped: boolean;
  skipReason: string | null;
  skippedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Map a persisted row into the privacy-safe view, narrowing controlled columns
 * to their union types. Unknown controlled values (e.g. from an older row) are
 * coerced to safe defaults rather than throwing, so a read never crashes.
 */
export function toTodaySessionView(row: TodaySessionRow): TodaySessionView {
  return {
    id: row.id,
    userId: row.userId,
    localDate: row.localDate,
    timezoneSnapshot: row.timezoneSnapshot,
    primaryArticleId: row.primaryArticleId,
    backupArticleIds: toIdArray(row.backupArticleIds),
    targetSavedWordIds: toIdArray(row.targetSavedWordIds),
    reviewTargetCount: row.reviewTargetCount,
    status: isTodaySessionStatus(row.status) ? row.status : "active",
    source: isTodaySessionSource(row.source) ? row.source : "none",
    completionTier: isTodayCompletionTier(row.completionTier)
      ? row.completionTier
      : "none",
    generationReasonCode: isTodayGenerationReasonCode(row.generationReasonCode)
      ? row.generationReasonCode
      : "no_candidate",
    readingCompletedAt: row.readingCompletedAt,
    comprehensionCompletedAt: row.comprehensionCompletedAt,
    wordReviewCompletedAt: row.wordReviewCompletedAt,
    completedAt: row.completedAt,
    skipped: row.skipped,
    skipReason: isTodaySkipReason(row.skipReason) ? row.skipReason : null,
    skippedAt: row.skippedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Fetch the session for a user on a local date, or null when none exists.
 * Always scoped by the authenticated `userId`.
 */
export async function getTodaySession(
  userId: string,
  localDate: string,
): Promise<TodaySessionView | null> {
  const row = await prisma.todaySession.findUnique({
    where: { userId_localDate: { userId, localDate } },
  });
  return row ? toTodaySessionView(row) : null;
}

/**
 * Create a session from a generated plan. Controlled values are validated
 * before persistence; an invalid plan throws and nothing is written. The unique
 * `(userId, localDate)` constraint surfaces as a Prisma P2002 the caller can
 * recover from (concurrent first-load).
 */
export async function createTodaySession(args: {
  userId: string;
  localDate: string;
  timezoneSnapshot: string;
  plan: TodaySessionPlan;
}): Promise<TodaySessionView> {
  const { userId, localDate, timezoneSnapshot, plan } = args;

  assertControlledValue(TODAY_SESSION_SOURCES, plan.source, "source");
  assertControlledValue(
    TODAY_GENERATION_REASON_CODES,
    plan.generationReasonCode,
    "generationReasonCode",
  );

  const row = await prisma.todaySession.create({
    data: {
      userId,
      localDate,
      timezoneSnapshot,
      primaryArticleId: plan.primaryArticleId,
      backupArticleIds: plan.backupArticleIds,
      targetSavedWordIds: plan.targetSavedWordIds,
      reviewTargetCount: plan.reviewTargetCount,
      source: plan.source,
      generationReasonCode: plan.generationReasonCode,
      status: "active",
      completionTier: "none",
    },
  });
  return toTodaySessionView(row);
}

/** Fields a caller may update on an existing session. Controlled values validated. */
export type TodaySessionUpdate = {
  status?: string;
  completionTier?: string;
  readingCompletedAt?: Date | null;
  comprehensionCompletedAt?: Date | null;
  wordReviewCompletedAt?: Date | null;
  completedAt?: Date | null;
  skipped?: boolean;
  skipReason?: string | null;
  skippedAt?: Date | null;
};

/**
 * Update an existing session, scoped to the owning user. Returns the updated
 * view, or null when no row matched (wrong user or missing date). Controlled
 * values are validated before the write so invalid input never persists.
 */
export async function updateTodaySession(
  userId: string,
  localDate: string,
  update: TodaySessionUpdate,
): Promise<TodaySessionView | null> {
  const data: Prisma.TodaySessionUpdateInput = {};

  if (update.status !== undefined) {
    data.status = assertControlledValue(
      TODAY_SESSION_STATUSES,
      update.status,
      "status",
    );
  }
  if (update.completionTier !== undefined) {
    data.completionTier = assertControlledValue(
      TODAY_COMPLETION_TIERS,
      update.completionTier,
      "completionTier",
    );
  }
  if (update.skipReason !== undefined && update.skipReason !== null) {
    data.skipReason = assertControlledValue(
      TODAY_SKIP_REASONS,
      update.skipReason,
      "skipReason",
    );
  } else if (update.skipReason === null) {
    data.skipReason = null;
  }
  if (update.readingCompletedAt !== undefined)
    data.readingCompletedAt = update.readingCompletedAt;
  if (update.comprehensionCompletedAt !== undefined)
    data.comprehensionCompletedAt = update.comprehensionCompletedAt;
  if (update.wordReviewCompletedAt !== undefined)
    data.wordReviewCompletedAt = update.wordReviewCompletedAt;
  if (update.completedAt !== undefined) data.completedAt = update.completedAt;
  if (update.skipped !== undefined) data.skipped = update.skipped;
  if (update.skippedAt !== undefined) data.skippedAt = update.skippedAt;

  // updateMany scoped by BOTH userId and localDate guarantees user isolation
  // (a mismatched userId updates nothing) without trusting a request id.
  const result = await prisma.todaySession.updateMany({
    where: { userId, localDate },
    data,
  });
  if (result.count === 0) return null;
  return getTodaySession(userId, localDate);
}
