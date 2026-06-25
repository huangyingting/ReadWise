/**
 * Prisma-backed loaders that feed the pure overview and retention computations.
 * Each loader resolves the optional segment, builds the query `where` clause,
 * runs an efficient groupBy / findMany, and delegates to the pure functions.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AnalyticsTimeRange } from "@/lib/analytics/queries/range";
import type { AnalyticsSegment, SegmentResolver } from "@/lib/analytics/queries/segments";
import { resolveSegmentUserIds } from "@/lib/analytics/queries/segments";
import { type EventUserStat, computeOverview, type AnalyticsOverview } from "@/lib/analytics/queries/overview";
import { computeRetentionCohorts, startOfUtcWeek, WEEK_MS, type RetentionCohort } from "@/lib/analytics/queries/retention";

type GroupClient = Pick<typeof prisma, "analyticsEvent">;

function buildWhere(
  range: AnalyticsTimeRange,
  userIds: string[] | null,
): Prisma.AnalyticsEventWhereInput {
  const where: Prisma.AnalyticsEventWhereInput = {};
  if (range.since || range.until) {
    where.occurredAt = {
      ...(range.since ? { gte: range.since } : {}),
      ...(range.until ? { lt: range.until } : {}),
    };
  }
  if (userIds !== null) {
    where.userId = { in: userIds };
  }
  return where;
}

export type OverviewOpts = AnalyticsTimeRange & {
  segment?: AnalyticsSegment;
  client?: GroupClient;
  resolveSegment?: SegmentResolver;
};

/**
 * Loads (type, user) aggregates within the range/segment and computes the full
 * overview. Uses a single `groupBy` so the DB does the distinct-pair dedup.
 */
export async function getAnalyticsOverview(
  opts: OverviewOpts = {},
): Promise<AnalyticsOverview & { segmentUserCount: number | null }> {
  const client = opts.client ?? prisma;
  const resolve = opts.resolveSegment ?? ((s: AnalyticsSegment) => resolveSegmentUserIds(s));
  const userIds = opts.segment ? await resolve(opts.segment) : null;

  // A requested segment that matches nobody → empty overview (avoid `in: []`
  // scanning the whole table; just short-circuit).
  if (userIds !== null && userIds.length === 0) {
    return { ...computeOverview([]), segmentUserCount: 0 };
  }

  const where = buildWhere(opts, userIds);
  const rows = await client.analyticsEvent.groupBy({
    by: ["type", "userId"],
    where,
    _count: { _all: true },
  });
  const stats: EventUserStat[] = rows.map((r) => ({
    type: r.type,
    userId: r.userId,
    count: r._count._all,
  }));
  return {
    ...computeOverview(stats),
    segmentUserCount: userIds === null ? null : userIds.length,
  };
}

export type RetentionOpts = {
  weeks?: number;
  now?: Date;
  segment?: AnalyticsSegment;
  client?: GroupClient;
  resolveSegment?: SegmentResolver;
};

/**
 * Loads the events needed for a `weeks`-wide retention window (aligned to UTC
 * weeks) and computes weekly retention cohorts. Only `userId`/`occurredAt` are
 * selected — no metadata is loaded.
 */
export async function getRetentionCohorts(
  opts: RetentionOpts = {},
): Promise<RetentionCohort[]> {
  const client = opts.client ?? prisma;
  const resolve = opts.resolveSegment ?? ((s: AnalyticsSegment) => resolveSegmentUserIds(s));
  const now = opts.now ?? new Date();
  const weeks = Math.max(1, Math.min(52, Math.floor(opts.weeks ?? 8)));
  const userIds = opts.segment ? await resolve(opts.segment) : null;
  if (userIds !== null && userIds.length === 0) {
    return computeRetentionCohorts([], { now, weeks });
  }

  const currentWeekStart = startOfUtcWeek(now);
  const windowStart = new Date(currentWeekStart.getTime() - (weeks - 1) * WEEK_MS);
  const where: Prisma.AnalyticsEventWhereInput = {
    occurredAt: { gte: windowStart },
    ...(userIds !== null ? { userId: { in: userIds } } : {}),
  };
  const rows = await client.analyticsEvent.findMany({
    where,
    select: { userId: true, occurredAt: true },
  });
  return computeRetentionCohorts(rows, { now, weeks });
}
