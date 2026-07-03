/**
 * Pure weekly retention-cohort computation. Operates on raw event rows with
 * only userId/occurredAt — no Prisma imports.
 */
import { percentage as pct } from "@/lib/aggregation";

export type CohortCell = { offset: number; count: number; pct: number };
export type RetentionCohort = {
  /** ISO date (UTC) of the cohort's first week (Monday). */
  cohortWeek: string;
  size: number;
  cells: CohortCell[];
};

/** Minimal event row for retention (no metadata needed). */
export type RetentionEvent = { userId: string | null; occurredAt: Date };

const DEFAULT_WEEKS = 8;
const MIN_WEEKS = 1;
const MAX_WEEKS = 52;

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

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeWeekCount(weeks: number | undefined): number {
  return Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Math.floor(weeks ?? DEFAULT_WEEKS)));
}

function getOrCreateUserWeeks(
  userWeeks: Map<string, Set<number>>,
  userId: string,
): Set<number> {
  let set = userWeeks.get(userId);
  if (!set) {
    set = new Set<number>();
    userWeeks.set(userId, set);
  }
  return set;
}

function buildCohortCells(
  members: string[],
  cohortIdx: number,
  weeks: number,
  userWeeks: Map<string, Set<number>>,
): CohortCell[] {
  const cells: CohortCell[] = [];
  for (let offset = 0; offset + cohortIdx < weeks; offset++) {
    const weekIdx = cohortIdx + offset;
    let count = 0;
    for (const userId of members) {
      if (userWeeks.get(userId)?.has(weekIdx)) count++;
    }
    cells.push({ offset, count, pct: pct(count, members.length) });
  }
  return cells;
}

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
  const weeks = normalizeWeekCount(opts.weeks);
  const currentWeekStart = startOfUtcWeek(now);
  const windowStart = new Date(currentWeekStart.getTime() - (weeks - 1) * WEEK_MS);
  const windowStartTime = windowStart.getTime();
  const currentWeekStartTime = currentWeekStart.getTime();

  // Bucket distinct (user, week-index) activity within the window.
  const userWeeks = new Map<string, Set<number>>();
  for (const ev of events) {
    if (!ev.userId) continue;
    const ws = startOfUtcWeek(new Date(ev.occurredAt));
    const weekStartTime = ws.getTime();
    if (weekStartTime < windowStartTime || weekStartTime > currentWeekStartTime) {
      continue;
    }
    const idx = Math.round((weekStartTime - windowStartTime) / WEEK_MS);
    getOrCreateUserWeeks(userWeeks, ev.userId).add(idx);
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
    const cells = buildCohortCells(members, cohortIdx, weeks, userWeeks);
    cohorts.push({
      cohortWeek: cohortWeekDate.toISOString().slice(0, 10),
      size,
      cells,
    });
  }
  return cohorts;
}
