/**
 * Streak and shield service for the engagement subsystem.
 *
 * Shield constants are exported so the activity service can reuse the same
 * earn/cap rules without reimplementing them.
 *
 * Day boundaries use the user's stored IANA timezone (default UTC).
 * DailyActivity.date is stored as "UTC midnight of the local calendar date",
 * so toISOString().slice(0,10) always gives the correct local date string.
 */

import { prisma } from "@/lib/prisma";
import { dateKey } from "./time";

const DEFAULT_DAILY_GOAL = 2;
const DEFAULT_TIMEZONE = "UTC";
const ACTIVITY_HISTORY_DAYS = 1095;
const ONE_DAY_MS = 86_400_000;
const LAST_7_DAYS = 7;

/** Consecutive active days required to earn a streak shield. */
export const SHIELD_EARN_STREAK = 7;

/** Maximum shields a user may hold simultaneously. */
export const MAX_SHIELDS = 1;

export type DayActivity = {
  date: string; // YYYY-MM-DD (local calendar date)
  active: boolean;
};

export type StreakSummary = {
  currentStreak: number;
  longestStreak: number;
  dailyGoal: number;
  todayProgress: number;
  last7Days: DayActivity[];
  /** Streak shields available for streak recovery (max 1). */
  streakShields: number;
};

type ActivityRow = {
  date: Date;
  articlesRead: number;
};

function activityDateKey(activity: ActivityRow): string {
  return activity.date.toISOString().slice(0, 10);
}

function activeDateKeys(activities: ActivityRow[]): Set<string> {
  const activeDates = new Set<string>();
  for (const activity of activities) {
    if (activity.articlesRead > 0) activeDates.add(activityDateKey(activity));
  }
  return activeDates;
}

function findTodayProgress(activities: ActivityRow[], today: string): number {
  return (
    activities.find((activity) => activityDateKey(activity) === today)
      ?.articlesRead ?? 0
  );
}

function resolveStreakAnchor(
  activeDates: Set<string>,
  today: string,
  yesterday: string,
): string | null {
  if (activeDates.has(today)) return today;
  if (activeDates.has(yesterday)) return yesterday;
  return null;
}

function countConsecutiveActiveDays(
  activeDates: Set<string>,
  anchor: string | null,
): number {
  if (!anchor) return 0;

  let count = 0;
  let cursor = new Date(anchor + "T00:00:00Z");
  while (activeDates.has(cursor.toISOString().slice(0, 10))) {
    count++;
    cursor = new Date(cursor.getTime() - ONE_DAY_MS);
  }
  return count;
}

function computeLongestStreak(activeDates: Set<string>): number {
  let longestStreak = 0;
  let run = 0;
  let prevMs: number | null = null;

  for (const key of [...activeDates].sort()) {
    const ms = new Date(key + "T00:00:00Z").getTime();
    if (prevMs !== null && ms - prevMs === ONE_DAY_MS) {
      run++;
    } else {
      run = 1;
    }
    longestStreak = Math.max(longestStreak, run);
    prevMs = ms;
  }

  return longestStreak;
}

function buildLast7Days(
  now: Date,
  timezone: string,
  activeDates: Set<string>,
): DayActivity[] {
  const days: DayActivity[] = [];
  for (let i = LAST_7_DAYS - 1; i >= 0; i--) {
    const key = dateKey(new Date(now.getTime() - i * ONE_DAY_MS), timezone);
    days.push({ date: key, active: activeDates.has(key) });
  }
  return days;
}

/**
 * Returns streak statistics, the last-7-days dot-row, and the shield count
 * for the dashboard gamification widgets.
 *
 * Streak rules:
 *  - A day is "active" when articlesRead > 0.
 *  - currentStreak counts consecutive active days ending on today; if today is
 *    not yet active but yesterday is, the streak anchors on yesterday.
 *  - longestStreak is the longest such run in the user's history.
 */
export async function getStreakSummary(userId: string, now?: Date): Promise<StreakSummary> {
  const [activities, profile] = await Promise.all([
    prisma.dailyActivity.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      select: { date: true, articlesRead: true },
      take: ACTIVITY_HISTORY_DAYS, // 3 years of daily rows
    }),
    prisma.profile.findUnique({
      where: { userId },
      select: { dailyGoal: true, timezone: true, streakShields: true },
    }),
  ]);

  const dailyGoal = profile?.dailyGoal ?? DEFAULT_DAILY_GOAL;
  const tz = profile?.timezone ?? DEFAULT_TIMEZONE;
  const streakShields = profile?.streakShields ?? 0;

  now = now ?? new Date();
  const todayStr = dateKey(now, tz);
  const yesterdayStr = dateKey(new Date(now.getTime() - ONE_DAY_MS), tz);
  const activeDates = activeDateKeys(activities);

  const todayProgress = findTodayProgress(activities, todayStr);
  const anchorStr = resolveStreakAnchor(activeDates, todayStr, yesterdayStr);
  const currentStreak = countConsecutiveActiveDays(activeDates, anchorStr);
  const longestStreak = computeLongestStreak(activeDates);
  const last7Days = buildLast7Days(now, tz, activeDates);

  return {
    currentStreak,
    longestStreak,
    dailyGoal,
    todayProgress,
    last7Days,
    streakShields,
  };
}
