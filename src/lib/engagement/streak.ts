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
      take: 1095, // 3 years of daily rows
    }),
    prisma.profile.findUnique({
      where: { userId },
      select: { dailyGoal: true, timezone: true, streakShields: true },
    }),
  ]);

  const dailyGoal = profile?.dailyGoal ?? 2;
  const tz = profile?.timezone ?? "UTC";
  const streakShields = profile?.streakShields ?? 0;

  const activeDates = new Set<string>();
  for (const a of activities) {
    if (a.articlesRead > 0) activeDates.add(a.date.toISOString().slice(0, 10));
  }

  now = now ?? new Date();
  const todayStr = dateKey(now, tz);
  const yesterdayStr = dateKey(new Date(now.getTime() - 86_400_000), tz);

  const todayRow = activities.find(
    (a) => a.date.toISOString().slice(0, 10) === todayStr,
  );
  const todayProgress = todayRow?.articlesRead ?? 0;

  // Streak anchor: today if active, yesterday otherwise
  let currentStreak = 0;
  let anchorStr: string | null = null;
  if (activeDates.has(todayStr)) {
    anchorStr = todayStr;
  } else if (activeDates.has(yesterdayStr)) {
    anchorStr = yesterdayStr;
  }

  if (anchorStr) {
    let cursor = new Date(anchorStr + "T00:00:00Z");
    while (activeDates.has(cursor.toISOString().slice(0, 10))) {
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

  // Last 7 days (oldest → newest) using the user's local timezone
  const last7Days: DayActivity[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const key = dateKey(d, tz);
    last7Days.push({ date: key, active: activeDates.has(key) });
  }

  return {
    currentStreak,
    longestStreak,
    dailyGoal,
    todayProgress,
    last7Days,
    streakShields,
  };
}
