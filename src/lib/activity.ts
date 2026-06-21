/**
 * Reading-activity tracking and streak calculation (US-M6).
 *
 * DailyActivity rows store how many DISTINCT articles a user progressed on a
 * given UTC calendar day. `recordReadingActivity` is called as a side-effect
 * from `saveProgress` — it recomputes the distinct count from ReadingProgress
 * (idempotent: same article saved twice in one day still counts once) and
 * upserts the DailyActivity row.
 */

import { prisma } from "@/lib/prisma";

/** ISO YYYY-MM-DD key for a Date (UTC). */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UTC midnight for the given date (or now). */
function utcMidnight(d: Date = new Date()): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

// ---------------------------------------------------------------------------
// Heatmap helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export type HeatCell = {
  /** YYYY-MM-DD UTC */
  date: string;
  /** raw articles read on this day */
  count: number;
  /** 0–4 heat level (0 = no activity) */
  level: 0 | 1 | 2 | 3 | 4;
};

/**
 * Compute a 0–4 heat level from an article count.
 * Thresholds: 0 → 0, 1 → 1, 2–3 → 2, 4–5 → 3, 6+ → 4.
 * Exported so tests can verify it without a DB.
 */
export function heatLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

/**
 * Build a fully-populated 52-week (364 + today = 365 cell) heatmap grid
 * from a sparse map of date → articlesRead.
 *
 * Exported for unit tests.
 */
export function buildHeatmapCells(
  activityMap: Map<string, number>,
  /** Today's UTC date string YYYY-MM-DD. Defaults to actual today. */
  todayStr?: string,
): HeatCell[] {
  const today = todayStr
    ? new Date(todayStr + "T00:00:00Z")
    : utcMidnight();
  const cells: HeatCell[] = [];
  // 364 days back (= 52 weeks) + today = 365 cells
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = dateKey(d);
    const count = activityMap.get(key) ?? 0;
    cells.push({ date: key, count, level: heatLevel(count) });
  }
  return cells;
}

/**
 * Upserts today's DailyActivity with a fresh count of distinct articles the
 * user progressed today.  Idempotent — safe to call on every progress save.
 */
export async function recordReadingActivity(
  userId: string,
  _articleId: string,
): Promise<void> {
  const today = utcMidnight();
  const tomorrow = new Date(today.getTime() + 86_400_000);

  // Distinct articles whose progress was last updated today
  const rows = await prisma.readingProgress.findMany({
    where: { userId, updatedAt: { gte: today, lt: tomorrow } },
    select: { articleId: true },
    distinct: ["articleId"],
  });

  await prisma.dailyActivity.upsert({
    where: { userId_date: { userId, date: today } },
    update: { articlesRead: rows.length },
    create: { userId, date: today, articlesRead: rows.length },
  });
}

export type DayActivity = {
  date: string; // YYYY-MM-DD UTC
  active: boolean;
};

export type StreakSummary = {
  currentStreak: number;
  longestStreak: number;
  dailyGoal: number;
  todayProgress: number;
  last7Days: DayActivity[];
};

/**
 * Returns streak statistics and the last-7-days dot-row for the dashboard.
 *
 * Streak rules:
 *  - A day is "active" when articlesRead > 0.
 *  - currentStreak counts consecutive active days ending on today; if today is
 *    not yet active but yesterday is, the streak counts from yesterday instead
 *    (so a streak isn't broken by an in-progress day).
 *  - longestStreak is the longest such run anywhere in the user's history.
 */
export async function getStreakSummary(
  userId: string,
): Promise<StreakSummary> {
  const [activities, profile] = await Promise.all([
    prisma.dailyActivity.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      select: { date: true, articlesRead: true },
      take: 1095, // 3 years of daily activity rows — covers any realistic streak
    }),
    prisma.profile.findUnique({
      where: { userId },
      select: { dailyGoal: true },
    }),
  ]);

  const dailyGoal = profile?.dailyGoal ?? 2;

  // Build a set of active date keys (YYYY-MM-DD)
  const activeDates = new Set<string>();
  for (const a of activities) {
    if (a.articlesRead > 0) activeDates.add(dateKey(a.date));
  }

  const todayDate = new Date();
  const todayStr = dateKey(todayDate);
  const yesterdayStr = dateKey(new Date(todayDate.getTime() - 86_400_000));

  // Today's progress count
  const todayRow = activities.find((a) => dateKey(a.date) === todayStr);
  const todayProgress = todayRow?.articlesRead ?? 0;

  // Determine streak anchor: today if active, yesterday otherwise
  let currentStreak = 0;
  let anchorStr: string | null = null;
  if (activeDates.has(todayStr)) {
    anchorStr = todayStr;
  } else if (activeDates.has(yesterdayStr)) {
    anchorStr = yesterdayStr;
  }

  if (anchorStr) {
    // Walk backward from anchor, counting consecutive active days
    let cursor = new Date(anchorStr + "T00:00:00Z");
    while (activeDates.has(dateKey(cursor))) {
      currentStreak++;
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
  }

  // Longest streak: scan sorted active dates
  let longestStreak = 0;
  let run = 0;
  let prevMs: number | null = null;
  for (const key of [...activeDates].sort()) {
    const ms = new Date(key + "T00:00:00Z").getTime();
    if (prevMs !== null && ms - prevMs === 86_400_000) {
      run++;
    } else {
      run = 1;
    }
    longestStreak = Math.max(longestStreak, run);
    prevMs = ms;
  }

  // Last 7 days (oldest → newest so the UI renders left-to-right)
  const last7Days: DayActivity[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayDate.getTime() - i * 86_400_000);
    const key = dateKey(d);
    last7Days.push({ date: key, active: activeDates.has(key) });
  }

  return { currentStreak, longestStreak, dailyGoal, todayProgress, last7Days };
}

/**
 * Returns a 365-cell (52-week + today) heatmap for the given user.
 * Query is bounded to the last 53 weeks for safety.
 */
export async function getActivityHeatmap(userId: string): Promise<HeatCell[]> {
  const fiftyThreeWeeksAgo = new Date(Date.now() - 53 * 7 * 86_400_000);
  const rows = await prisma.dailyActivity.findMany({
    where: { userId, date: { gte: fiftyThreeWeeksAgo } },
    select: { date: true, articlesRead: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(dateKey(r.date), r.articlesRead);
  }
  return buildHeatmapCells(map);
}
