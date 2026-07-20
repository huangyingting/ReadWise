/**
 * Thin backfill QUERY layer (issue #1101, Phase 3.2).
 *
 * Read-only, metadata-only Prisma reads for the capability-gated admin backfill
 * API: the DRY-RUN preview (bounded counts + warnings, creating NO Job and
 * fetching NO article body — AC) and the sanitized run DTOs (status / progress).
 * Every field is a controlled id, status enum, count, timestamp, sanitized
 * reason CATEGORY, or a bounds value — never a raw URL, response body, secret,
 * article text, or any user-private content. It NEVER mutates state or enqueues
 * work.
 *
 * {@link eligibleBackfillCandidateWhere} is the ONE shared predicate for "a
 * matching historical identity a backfill may reactivate" — reused by the commit
 * so the dry-run count and the real reactivation scan can never diverge. It
 * selects OBSERVED_BASELINE (status BASELINE), OBSERVED_SHADOW (status
 * DISCOVERED, not observed-in-baseline), and inert SKIPPED_OUTSIDE_WINDOW (a
 * dated ACTIVE-source item at/before the discovery window, #1127) identities
 * that have NO Article, whose Article was never created-and-deleted, and whose
 * TRUSTED publication date falls inside the effective window. Candidates with an
 * UNKNOWN publication date are deliberately excluded from a windowed backfill —
 * an identity that cannot be confirmed to fall in the approved interval is never
 * reactivated.
 */
import { CrawlCandidateStatus, Prisma, BackfillRunStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import type { EffectiveBackfillBounds } from "./backfill-policy";

/**
 * The concrete backfill-run statuses an admin may filter the list by. Mirrors the
 * Prisma {@link BackfillRunStatus} enum so the route can validate `?status=` from
 * an untrusted query without trusting arbitrary input.
 */
export const BACKFILL_RUN_STATUSES = [
  BackfillRunStatus.RUNNING,
  BackfillRunStatus.PAUSED,
  BackfillRunStatus.COMPLETED,
  BackfillRunStatus.CANCELLED,
  BackfillRunStatus.FAILED,
] as const;
export type BackfillRunStatusFilter = (typeof BACKFILL_RUN_STATUSES)[number];

/** Scope of a backfill scan: one provider, optionally one discovery source. */
export type BackfillScanScope = {
  providerKey: string;
  discoverySourceId?: string | null;
};

/**
 * The shared Prisma predicate for a reactivation-eligible historical identity
 * within the effective window. The commit spreads this and adds the checkpoint
 * cursor; the query counts it for the dry-run. Keeping it in ONE place means the
 * preview count and the real scan are always the same set.
 */
export function eligibleBackfillCandidateWhere(
  scope: BackfillScanScope,
  bounds: EffectiveBackfillBounds,
): Prisma.CrawlCandidateWhereInput {
  return {
    providerKey: scope.providerKey,
    ...(scope.discoverySourceId ? { discoverySourceId: scope.discoverySourceId } : {}),
    articleId: null,
    articleDeletedAt: null,
    trustedPublishedAt: { gte: bounds.windowStart, lte: bounds.windowEnd },
    OR: [
      { status: CrawlCandidateStatus.BASELINE },
      { status: CrawlCandidateStatus.DISCOVERED, observedInBaseline: false },
      { status: CrawlCandidateStatus.SKIPPED_OUTSIDE_WINDOW },
    ],
  };
}

/** Sanitized dry-run preview of what an approved backfill WOULD reactivate. */
export type BackfillPreview = {
  /** Total identities the run would reactivate (bounded by the effective window). */
  eligibleCount: number;
  /** Of those, identities matched from the source baseline (status BASELINE). */
  observedBaselineCount: number;
  /** Of those, post-baseline shadow identities (status DISCOVERED, not baseline). */
  observedShadowCount: number;
  /**
   * Of those, inert SKIPPED_OUTSIDE_WINDOW identities — a dated ACTIVE-source
   * item persisted at/before the discovery window (#1127), reactivatable only by
   * an approved windowed backfill.
   */
  skippedOutsideWindowCount: number;
  /**
   * Identities in the same window that ALREADY link a public Article — reported
   * for transparency and NEVER recreated by backfill (governing invariant).
   */
  knownWithArticleCount: number;
  /** How many identities the run will actually reactivate after the item cap. */
  effectiveReactivationCount: number;
};

/**
 * Computes the DRY-RUN preview for an effective backfill scope + bounds using
 * COUNT queries only — it creates no run, no Job, and fetches no body. The
 * effective reactivation count is the eligible count capped at `maxItems`.
 */
export async function previewBackfill(
  scope: BackfillScanScope,
  bounds: EffectiveBackfillBounds,
): Promise<BackfillPreview> {
  const eligibleWhere = eligibleBackfillCandidateWhere(scope, bounds);

  const [observedBaselineCount, observedShadowCount, skippedOutsideWindowCount, knownWithArticleCount] =
    await Promise.all([
      prisma.crawlCandidate.count({
        where: {
          providerKey: scope.providerKey,
          ...(scope.discoverySourceId ? { discoverySourceId: scope.discoverySourceId } : {}),
          articleId: null,
          articleDeletedAt: null,
          trustedPublishedAt: { gte: bounds.windowStart, lte: bounds.windowEnd },
          status: CrawlCandidateStatus.BASELINE,
        },
      }),
      prisma.crawlCandidate.count({
        where: {
          providerKey: scope.providerKey,
          ...(scope.discoverySourceId ? { discoverySourceId: scope.discoverySourceId } : {}),
          articleId: null,
          articleDeletedAt: null,
          trustedPublishedAt: { gte: bounds.windowStart, lte: bounds.windowEnd },
          status: CrawlCandidateStatus.DISCOVERED,
          observedInBaseline: false,
        },
      }),
      prisma.crawlCandidate.count({
        where: {
          providerKey: scope.providerKey,
          ...(scope.discoverySourceId ? { discoverySourceId: scope.discoverySourceId } : {}),
          articleId: null,
          articleDeletedAt: null,
          trustedPublishedAt: { gte: bounds.windowStart, lte: bounds.windowEnd },
          status: CrawlCandidateStatus.SKIPPED_OUTSIDE_WINDOW,
        },
      }),
      prisma.crawlCandidate.count({
        where: {
          providerKey: scope.providerKey,
          ...(scope.discoverySourceId ? { discoverySourceId: scope.discoverySourceId } : {}),
          trustedPublishedAt: { gte: bounds.windowStart, lte: bounds.windowEnd },
          articleId: { not: null },
        },
      }),
    ]);
  // Sanity: the eligible count is exactly the three target buckets combined;
  // count it independently so a future predicate change can't silently desync.
  const eligibleCount = await prisma.crawlCandidate.count({ where: eligibleWhere });

  return {
    eligibleCount,
    observedBaselineCount,
    observedShadowCount,
    skippedOutsideWindowCount,
    knownWithArticleCount,
    effectiveReactivationCount: Math.min(eligibleCount, bounds.maxItems),
  };
}

/** A sanitized backfill-run DTO for the admin API (metadata only). */
export type BackfillRunDto = {
  id: string;
  providerKey: string;
  discoverySourceId: string | null;
  actorId: string | null;
  /** Sanitized operator reason text (required at creation). */
  reason: string;
  requestedWindowStart: Date | null;
  requestedWindowEnd: Date | null;
  requestedMaxItems: number;
  windowStart: Date | null;
  windowEnd: Date | null;
  maxItems: number;
  status: BackfillRunStatus;
  /** Opaque last-processed candidate id (resume checkpoint) — never a URL. */
  checkpointCursor: string | null;
  matchedCount: number;
  reactivatedCount: number;
  skippedCount: number;
  failedCount: number;
  /** Sanitized clamp warning categories. */
  warnings: string[];
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const RUN_DTO_SELECT = {
  id: true,
  providerKey: true,
  discoverySourceId: true,
  actorId: true,
  reason: true,
  requestedWindowStart: true,
  requestedWindowEnd: true,
  requestedMaxItems: true,
  windowStart: true,
  windowEnd: true,
  maxItems: true,
  status: true,
  checkpointCursor: true,
  matchedCount: true,
  reactivatedCount: true,
  skippedCount: true,
  failedCount: true,
  warnings: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BackfillRunSelect;

type BackfillRunRow = Prisma.BackfillRunGetPayload<{ select: typeof RUN_DTO_SELECT }>;

/** Coerces the `warnings` Json column to a sanitized string[] for the DTO. */
function warningsToStrings(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((w): w is string => typeof w === "string");
}

function toRunDto(row: BackfillRunRow): BackfillRunDto {
  return {
    id: row.id,
    providerKey: row.providerKey,
    discoverySourceId: row.discoverySourceId,
    actorId: row.actorId,
    reason: row.reason,
    requestedWindowStart: row.requestedWindowStart,
    requestedWindowEnd: row.requestedWindowEnd,
    requestedMaxItems: row.requestedMaxItems,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    maxItems: row.maxItems,
    status: row.status,
    checkpointCursor: row.checkpointCursor,
    matchedCount: row.matchedCount,
    reactivatedCount: row.reactivatedCount,
    skippedCount: row.skippedCount,
    failedCount: row.failedCount,
    warnings: warningsToStrings(row.warnings),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Lists the ids of RUNNING backfill runs the sibling driver loop should advance,
 * oldest-first (FIFO fairness across runs). Ids only — the driver re-reads each
 * run under its guarded advance, so a run paused/cancelled between this list and
 * the advance is a safe no-op.
 */
export async function listRunnableBackfillRunIds(limit = 20): Promise<string[]> {
  const rows = await prisma.backfillRun.findMany({
    where: { status: "RUNNING" },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: Math.min(Math.max(1, limit), 200),
  });
  return rows.map((r) => r.id);
}

/** Fetches ONE backfill run as a sanitized DTO, or null when it does not exist. */
export async function getBackfillRun(id: string): Promise<BackfillRunDto | null> {
  const row = await prisma.backfillRun.findUnique({ where: { id }, select: RUN_DTO_SELECT });
  return row ? toRunDto(row) : null;
}

/** Filters for {@link listBackfillRuns}. */
export type BackfillRunFilter = {
  status?: BackfillRunStatus;
  providerKey?: string;
  offset?: number;
  limit?: number;
};

/** A bounded, filtered page of backfill runs + the total match count. */
export type BackfillRunPage = {
  runs: BackfillRunDto[];
  total: number;
  offset: number;
  limit: number;
};

/**
 * Lists backfill runs (newest first) with optional status/provider filters and
 * offset/limit pagination. Reads only sanitized columns.
 */
export async function listBackfillRuns(filter: BackfillRunFilter = {}): Promise<BackfillRunPage> {
  const where: Prisma.BackfillRunWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.providerKey) where.providerKey = filter.providerKey;

  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.min(Math.max(1, filter.limit ?? 50), 200);

  const [total, rows] = await Promise.all([
    prisma.backfillRun.count({ where }),
    prisma.backfillRun.findMany({
      where,
      select: RUN_DTO_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit,
    }),
  ]);

  return { runs: rows.map(toRunDto), total, offset, limit };
}
