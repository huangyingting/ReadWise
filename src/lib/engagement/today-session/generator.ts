/**
 * Today Session — idempotent daily generation (#790, #791).
 *
 * @server-only — imports Prisma and the Recommendations Picks feed.
 *
 * `getOrCreateTodaySession` produces ONE stable plan per `(userId, localDate)`:
 *   - resume a recent, in-progress, still-readable article first;
 *   - otherwise fall back to personalized Picks for a primary + stable backups;
 *   - otherwise emit a no-candidate browse/import prompt state.
 *
 * Idempotency: an existing row is returned unchanged; a concurrent first-load
 * that loses the `(userId, localDate)` unique race recovers by re-reading the
 * winner's row (Prisma P2002). Today owns orchestration only — article scoring
 * stays in Recommendations (`listScoredPicksPage`), and only ids/anchors are
 * persisted, never learning content.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publicListableArticleWhere } from "@/lib/article-library";
import { listScoredPicksPage } from "@/lib/recommendations/picks";
import {
  createTodaySession,
  getTodaySession,
} from "./repository";
import { resolveLocalDate } from "./local-date";
import { selectTargetWordIds } from "./target-words";
import type { TodaySessionPlan, TodaySessionView } from "./types";

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** Resume window: only articles between these progress percents are eligible. */
export const RESUME_MIN_PERCENT = 15;
export const RESUME_MAX_PERCENT = 94;

/** Resume staleness window: progress must have moved within this many days. */
export const RESUME_RECENT_DAYS = 7;

/** Number of backup article ids stored for the local day. */
export const BACKUP_ARTICLE_COUNT = 3;

/** How many Picks to fetch so a primary + stable backups can be chosen. */
const PICKS_FETCH_LIMIT = BACKUP_ARTICLE_COUNT + 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

// ---------------------------------------------------------------------------
// Plan building
// ---------------------------------------------------------------------------

/**
 * Find the most recent resume candidate: an incomplete article with progress in
 * [RESUME_MIN_PERCENT, RESUME_MAX_PERCENT], updated within the recency window,
 * and still publicly readable. Returns the article id or null.
 */
async function findResumeArticleId(
  userId: string,
  now: Date,
): Promise<string | null> {
  const cutoff = new Date(now.getTime() - RESUME_RECENT_DAYS * MS_PER_DAY);
  const row = await prisma.readingProgress.findFirst({
    where: {
      userId,
      completed: false,
      percent: { gte: RESUME_MIN_PERCENT, lte: RESUME_MAX_PERCENT },
      updatedAt: { gte: cutoff },
      article: publicListableArticleWhere(),
    },
    orderBy: { updatedAt: "desc" },
    select: { articleId: true },
  });
  return row?.articleId ?? null;
}

/**
 * Fetch ranked Picks article ids for the user, excluding any ids in `exclude`
 * (e.g. the current/primary article) so backups never duplicate the primary.
 */
async function fetchPickIds(
  userId: string,
  exclude: Set<string>,
): Promise<string[]> {
  const page = await listScoredPicksPage(userId, { limit: PICKS_FETCH_LIMIT });
  return page.articles.map((a) => a.id).filter((id) => !exclude.has(id));
}

/**
 * Build the day's plan: resume-first, then Picks fallback, then no-candidate.
 * Article ids returned here are already revalidated (resume via the readable
 * where-clause; backups via the publicly-listable Picks feed).
 */
export async function buildTodayPlan(args: {
  userId: string;
  now: Date;
}): Promise<TodaySessionPlan> {
  const { userId, now } = args;

  const resumeArticleId = await findResumeArticleId(userId, now);

  let primaryArticleId: string | null;
  let backupArticleIds: string[];
  let source: TodaySessionPlan["source"];
  let generationReasonCode: TodaySessionPlan["generationReasonCode"];

  if (resumeArticleId) {
    primaryArticleId = resumeArticleId;
    backupArticleIds = (
      await fetchPickIds(userId, new Set([resumeArticleId]))
    ).slice(0, BACKUP_ARTICLE_COUNT);
    source = "resume";
    generationReasonCode = "resume_in_progress";
  } else {
    const pickIds = await fetchPickIds(userId, new Set());
    if (pickIds.length > 0) {
      primaryArticleId = pickIds[0];
      backupArticleIds = pickIds.slice(1, 1 + BACKUP_ARTICLE_COUNT);
      source = "picks";
      generationReasonCode = "picks_primary";
    } else {
      primaryArticleId = null;
      backupArticleIds = [];
      source = "none";
      generationReasonCode = "no_candidate";
    }
  }

  const { targetSavedWordIds, reviewTargetCount } = await selectTargetWordIds({
    userId,
    primaryArticleId,
    now,
  });

  return {
    primaryArticleId,
    backupArticleIds,
    targetSavedWordIds,
    reviewTargetCount,
    source,
    generationReasonCode,
  };
}

// ---------------------------------------------------------------------------
// Get-or-create
// ---------------------------------------------------------------------------

/**
 * Return the learner's stable Today session for a local day, creating it on
 * first load. Idempotent on `(userId, localDate)`.
 *
 * `localDate`/`timezoneSnapshot` may be supplied directly; otherwise they are
 * resolved from the profile timezone (falling back to a request zone, then UTC).
 */
export async function getOrCreateTodaySession(args: {
  userId: string;
  localDate?: string;
  timezoneSnapshot?: string;
  requestTimezone?: string | null;
  now?: Date;
}): Promise<TodaySessionView> {
  const { userId, requestTimezone, now = new Date() } = args;

  let localDate = args.localDate;
  let timezoneSnapshot = args.timezoneSnapshot;
  if (!localDate || !timezoneSnapshot) {
    const resolved = await resolveLocalDate({ userId, requestTimezone, now });
    localDate = localDate ?? resolved.localDate;
    timezoneSnapshot = timezoneSnapshot ?? resolved.timezone;
  }

  // Fast path: existing session is returned unchanged (idempotent).
  const existing = await getTodaySession(userId, localDate);
  if (existing) return existing;

  const plan = await buildTodayPlan({ userId, now });

  try {
    return await createTodaySession({
      userId,
      localDate,
      timezoneSnapshot,
      plan,
    });
  } catch (err) {
    // A concurrent first-load won the unique race — re-read its winning row.
    if (isUniqueConstraintError(err)) {
      const winner = await getTodaySession(userId, localDate);
      if (winner) return winner;
    }
    throw err;
  }
}
