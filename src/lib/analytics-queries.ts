/**
 * Product analytics aggregation queries (Epic RW-E010 — RW-052).
 *
 * Turns the append-only {@link import("@/lib/analytics").recordEvent} stream
 * (`AnalyticsEvent`) into the funnel / activation / reading-completion /
 * study-conversion / retention-cohort views the admin dashboards render. The
 * heavy aggregation is split into:
 *   - PURE functions ({@link computeOverview}, {@link computeRetentionCohorts})
 *     that operate on already-loaded event rows so they are unit-testable
 *     without a DB, and
 *   - DB loaders ({@link getAnalyticsOverview}, {@link getRetentionCohorts})
 *     that run an efficient Prisma `groupBy` and feed the pure functions.
 *
 * Every query supports a time range (`since`/`until` on `occurredAt`) and an
 * optional segment (English level / topic interest) resolved against `Profile`.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseTopics } from "@/lib/profile";
import { ANALYTICS_EVENT_TYPES } from "@/lib/analytics";
import { percentage as pct } from "@/lib/aggregation";

const T = ANALYTICS_EVENT_TYPES;

/** The ordered funnel stages: onboarding → read → save → quiz → study return. */
export const FUNNEL_STAGES: readonly { key: string; label: string }[] = [
  { key: T.onboardingComplete, label: "Onboarding complete" },
  { key: T.articleView, label: "Read an article" },
  { key: T.saveWord, label: "Saved a word" },
  { key: T.quizComplete, label: "Completed a quiz" },
  { key: T.studyReview, label: "Returned to study" },
];

/** Human labels for the feature-usage breakdown. */
const FEATURE_LABELS: Record<string, string> = {
  [T.onboardingStart]: "Onboarding started",
  [T.onboardingComplete]: "Onboarding complete",
  [T.articleView]: "Article views",
  [T.progressComplete]: "Reading completions",
  [T.lookup]: "Word lookups",
  [T.saveWord]: "Words saved",
  [T.quizStart]: "Quizzes started",
  [T.quizComplete]: "Quizzes completed",
  [T.translationUse]: "Translations used",
  [T.tutorUse]: "Tutor used",
  [T.offlineSave]: "Offline saves",
  [T.import]: "Imports",
  [T.studyReview]: "Study reviews",
};

export type AnalyticsTimeRange = {
  /** Inclusive lower bound on occurredAt. */
  since?: Date | null;
  /** Exclusive upper bound on occurredAt. */
  until?: Date | null;
};

/** Selectable look-back windows (days) for the dashboard time-range control. */
export const TIME_RANGE_PRESETS: readonly { days: number; label: string }[] = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last 12 months" },
];

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 365;

/**
 * Resolves a `days` look-back into a concrete `{ since, until }` window ending
 * at `now`. Clamps to a sane range so a hostile query can't scan forever.
 */
export function resolveTimeRange(
  days: number | null | undefined,
  now: Date = new Date(),
): { since: Date; until: Date; days: number } {
  const clamped =
    Number.isFinite(days) && (days ?? 0) > 0
      ? Math.min(MAX_RANGE_DAYS, Math.floor(days as number))
      : DEFAULT_RANGE_DAYS;
  const until = now;
  const since = new Date(now.getTime() - clamped * 24 * 60 * 60 * 1000);
  return { since, until, days: clamped };
}

export type AnalyticsSegment = {
  /** CEFR English level filter (matched against Profile.englishLevel). */
  level?: string | null;
  /** Topic-interest filter (matched against Profile.topics). */
  topic?: string | null;
};

/** One (type, user) aggregate row — the unit the pure functions consume. */
export type EventUserStat = {
  type: string;
  userId: string | null;
  count: number;
};

export type FunnelStage = {
  key: string;
  label: string;
  /** Cumulative distinct users who reached this AND every prior stage. */
  users: number;
  /** Conversion (%) from the previous stage (100 for the first stage). */
  conversionFromPrevPct: number;
  /** Conversion (%) from the first stage. */
  conversionFromStartPct: number;
};

export type RatioMetric = {
  numerator: number;
  denominator: number;
  ratePct: number;
};

export type FeatureUsage = {
  type: string;
  label: string;
  users: number;
  events: number;
};

export type AnalyticsOverview = {
  funnel: FunnelStage[];
  /** Onboarded users who went on to read an article. */
  activation: RatioMetric;
  /** Article readers who reached completion. */
  readingCompletion: RatioMetric;
  /** Word savers who returned to study/review. */
  studyConversion: RatioMetric;
  featureUsage: FeatureUsage[];
  totals: { events: number; users: number };
};

/** Builds a `type -> Set<userId>` map of DISTINCT (non-null) users per type. */
function usersByType(stats: EventUserStat[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const s of stats) {
    if (!s.userId) continue;
    let set = map.get(s.type);
    if (!set) {
      set = new Set<string>();
      map.set(s.type, set);
    }
    set.add(s.userId);
  }
  return map;
}

function intersectionSize(a: Set<string>, b: Set<string> | undefined): Set<string> {
  const out = new Set<string>();
  if (!b) return out;
  for (const id of a) if (b.has(id)) out.add(id);
  return out;
}

/**
 * Computes the full overview (funnel + activation + completion + study
 * conversion + feature usage) from already-loaded (type, user) aggregate rows.
 * Pure + deterministic — the unit tests feed it synthetic events.
 *
 * The funnel is a strict descending funnel: each stage counts users who have
 * performed that stage's action AND every prior stage's action.
 */
export function computeOverview(stats: EventUserStat[]): AnalyticsOverview {
  const byType = usersByType(stats);

  // --- Funnel: cumulative intersection across the ordered stages ----------
  const funnel: FunnelStage[] = [];
  let cumulative: Set<string> | null = null;
  let firstCount = 0;
  for (let i = 0; i < FUNNEL_STAGES.length; i++) {
    const stage = FUNNEL_STAGES[i];
    const stageUsers = byType.get(stage.key) ?? new Set<string>();
    cumulative =
      cumulative === null ? new Set(stageUsers) : intersectionSize(cumulative, stageUsers);
    const users = cumulative.size;
    if (i === 0) firstCount = users;
    const prev = funnel[i - 1]?.users ?? users;
    funnel.push({
      key: stage.key,
      label: stage.label,
      users,
      conversionFromPrevPct: i === 0 ? 100 : pct(users, prev),
      conversionFromStartPct: pct(users, firstCount || users || 1),
    });
  }

  // --- Activation: onboarded users who read an article --------------------
  const onboarded = byType.get(T.onboardingComplete) ?? new Set<string>();
  const readers = byType.get(T.articleView) ?? new Set<string>();
  const activatedUsers = intersectionSize(onboarded, readers);
  const activation: RatioMetric = {
    numerator: activatedUsers.size,
    denominator: onboarded.size,
    ratePct: pct(activatedUsers.size, onboarded.size),
  };

  // --- Reading completion: readers who reached completion -----------------
  const completers = byType.get(T.progressComplete) ?? new Set<string>();
  const completedReaders = intersectionSize(readers, completers);
  const readingCompletion: RatioMetric = {
    numerator: completedReaders.size,
    denominator: readers.size,
    ratePct: pct(completedReaders.size, readers.size),
  };

  // --- Study conversion: savers who returned to review --------------------
  const savers = byType.get(T.saveWord) ?? new Set<string>();
  const reviewers = byType.get(T.studyReview) ?? new Set<string>();
  const convertedSavers = intersectionSize(savers, reviewers);
  const studyConversion: RatioMetric = {
    numerator: convertedSavers.size,
    denominator: savers.size,
    ratePct: pct(convertedSavers.size, savers.size),
  };

  // --- Feature usage: distinct users + total events per type --------------
  const eventsByType = new Map<string, number>();
  for (const s of stats) {
    eventsByType.set(s.type, (eventsByType.get(s.type) ?? 0) + s.count);
  }
  const featureUsage: FeatureUsage[] = [...eventsByType.entries()]
    .map(([type, events]) => ({
      type,
      label: FEATURE_LABELS[type] ?? type,
      users: (byType.get(type) ?? new Set()).size,
      events,
    }))
    .sort((a, b) => b.events - a.events);

  const allUsers = new Set<string>();
  for (const set of byType.values()) for (const id of set) allUsers.add(id);
  const totalEvents = [...eventsByType.values()].reduce((sum, n) => sum + n, 0);

  return {
    funnel,
    activation,
    readingCompletion,
    studyConversion,
    featureUsage,
    totals: { events: totalEvents, users: allUsers.size },
  };
}

// ---------------------------------------------------------------------------
// Retention cohorts
// ---------------------------------------------------------------------------

export type CohortCell = { offset: number; count: number; pct: number };
export type RetentionCohort = {
  /** ISO date (UTC) of the cohort's first week (Monday). */
  cohortWeek: string;
  size: number;
  cells: CohortCell[];
};

/** Minimal event row for retention (no metadata needed). */
export type RetentionEvent = { userId: string | null; occurredAt: Date };

/** Returns the UTC Monday 00:00 of the week containing `date`. */
export function startOfUtcWeek(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // getUTCDay: 0=Sun..6=Sat. Shift so Monday is the start of the week.
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Computes weekly retention cohorts: users are grouped by the week of their
 * FIRST activity (within the window); each cell is the share of that cohort
 * active in a later week. Pure + deterministic.
 */
export function computeRetentionCohorts(
  events: RetentionEvent[],
  opts: { now?: Date; weeks?: number } = {},
): RetentionCohort[] {
  const now = opts.now ?? new Date();
  const weeks = Math.max(1, Math.min(52, Math.floor(opts.weeks ?? 8)));
  const currentWeekStart = startOfUtcWeek(now);
  const windowStart = new Date(currentWeekStart.getTime() - (weeks - 1) * WEEK_MS);

  // Bucket distinct (user, week-index) activity within the window.
  const userWeeks = new Map<string, Set<number>>();
  for (const ev of events) {
    if (!ev.userId) continue;
    const ws = startOfUtcWeek(new Date(ev.occurredAt));
    if (ws.getTime() < windowStart.getTime() || ws.getTime() > currentWeekStart.getTime()) {
      continue;
    }
    const idx = Math.round((ws.getTime() - windowStart.getTime()) / WEEK_MS);
    let set = userWeeks.get(ev.userId);
    if (!set) {
      set = new Set<number>();
      userWeeks.set(ev.userId, set);
    }
    set.add(idx);
  }

  // Assign each user to the cohort of their FIRST active week in the window.
  const cohortMembers = new Map<number, string[]>();
  for (const [userId, set] of userWeeks) {
    const first = Math.min(...set);
    const list = cohortMembers.get(first) ?? [];
    list.push(userId);
    cohortMembers.set(first, list);
  }

  const cohorts: RetentionCohort[] = [];
  for (let cohortIdx = 0; cohortIdx < weeks; cohortIdx++) {
    const members = cohortMembers.get(cohortIdx) ?? [];
    const size = members.length;
    const cohortWeekDate = new Date(windowStart.getTime() + cohortIdx * WEEK_MS);
    const cells: CohortCell[] = [];
    for (let offset = 0; offset + cohortIdx < weeks; offset++) {
      const weekIdx = cohortIdx + offset;
      let count = 0;
      for (const userId of members) {
        if (userWeeks.get(userId)?.has(weekIdx)) count++;
      }
      cells.push({ offset, count, pct: pct(count, size) });
    }
    cohorts.push({
      cohortWeek: cohortWeekDate.toISOString().slice(0, 10),
      size,
      cells,
    });
  }
  return cohorts;
}

// ---------------------------------------------------------------------------
// DB loaders
// ---------------------------------------------------------------------------

type GroupClient = Pick<typeof prisma, "analyticsEvent">;
type ProfileClient = Pick<typeof prisma, "profile">;

export type SegmentResolver = (
  segment: AnalyticsSegment,
) => Promise<string[] | null>;

/**
 * Resolves the set of user ids matching a segment (level/topic) against
 * `Profile`. Returns `null` when no segment is requested (no user filter), or
 * an array (possibly empty) of matching user ids. Topic filtering is done in
 * TS because `Profile.topics` is a JSON string array (no portable SQL filter).
 */
export async function resolveSegmentUserIds(
  segment: AnalyticsSegment,
  client: ProfileClient = prisma,
): Promise<string[] | null> {
  const level = segment.level?.trim() || null;
  const topic = segment.topic?.trim() || null;
  if (!level && !topic) return null;

  if (level && !topic) {
    const rows = await client.profile.findMany({
      where: { englishLevel: level },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  // Topic (optionally + level) requires parsing the JSON topics column.
  const rows = await client.profile.findMany({
    where: level ? { englishLevel: level } : {},
    select: { userId: true, topics: true },
  });
  if (!topic) return rows.map((r) => r.userId);
  return rows
    .filter((r) => parseTopics(r.topics).includes(topic))
    .map((r) => r.userId);
}

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
