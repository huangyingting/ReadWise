/**
 * Reading-activity tracking and streak calculation (US-M6).
 *
 * DailyActivity rows store how many DISTINCT articles a user progressed on a
 * given day. `recordReadingActivity` is called as a side-effect from
 * `saveProgress` — it recomputes the distinct count from ReadingProgress
 * (idempotent: same article saved twice in one day still counts once) and
 * upserts the DailyActivity row.
 *
 * Day boundaries are computed in the user's IANA timezone (stored on Profile,
 * column `timezone`). DailyActivity.date is stored as "UTC midnight of the
 * user's local calendar date", so existing UTC-based rows remain valid and
 * dateKey(storedDate) always gives back the correct local date string.
 *
 * Streak shields (#125): users earn one shield per SHIELD_EARN_STREAK
 * consecutive active days (max MAX_SHIELDS held at once). When a 1-day gap
 * is detected and a shield is available, the missed day is filled and the
 * shield consumed.
 */

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Date / timezone helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Returns the YYYY-MM-DD date string for `d` in the given IANA timezone.
 * Falls back to UTC on an invalid or missing timezone string.
 */
export function dateKey(d: Date, tz = "UTC"): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const p: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") p[part.type] = part.value;
    }
    return `${p.year}-${p.month}-${p.day}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Returns a Date at 00:00:00Z of the calendar day that `d` falls on in `tz`.
 *
 * Storage convention: DailyActivity.date is always this value.  For UTC users
 * the behaviour is identical to the old utcMidnight(); for non-UTC users a
 * reading at (say) 23:00 local is stored under the LOCAL calendar date rather
 * than the next UTC day.
 */
export function localDayStart(d: Date = new Date(), tz = "UTC"): Date {
  return new Date(dateKey(d, tz) + "T00:00:00Z");
}

// ---------------------------------------------------------------------------
// Heatmap helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export type HeatCell = {
  /** YYYY-MM-DD */
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
  /** Today's date string YYYY-MM-DD. Defaults to UTC today. */
  todayStr?: string,
): HeatCell[] {
  const today = todayStr
    ? new Date(todayStr + "T00:00:00Z")
    : localDayStart();
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

// ---------------------------------------------------------------------------
// Shield constants
// ---------------------------------------------------------------------------

/** Consecutive active days required to earn a streak shield. */
const SHIELD_EARN_STREAK = 7;

/** Maximum shields a user may hold simultaneously. */
const MAX_SHIELDS = 1;

// ---------------------------------------------------------------------------
// Activity recording
// ---------------------------------------------------------------------------

/**
 * Upserts the DailyActivity row for the user's current local calendar day,
 * handles streak-shield gap-fill, and awards a shield on a 7-day milestone.
 *
 * @param timezone - Override IANA timezone (takes precedence over the stored
 *   profile timezone). Useful when the client sends the browser timezone on
 *   the progress request so the day boundary is always local.
 */
export async function recordReadingActivity(
  userId: string,
  _articleId: string,
  timezone?: string,
): Promise<void> {
  const now = new Date();

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { timezone: true, streakShields: true },
  });

  const tz = timezone ?? profile?.timezone ?? "UTC";
  let currentShields = profile?.streakShields ?? 0;

  const todayDate = localDayStart(now, tz);
  const yesterdayDate = new Date(todayDate.getTime() - 86_400_000);
  const twoDaysAgoDate = new Date(todayDate.getTime() - 2 * 86_400_000);

  // ReadingProgress.updatedAt holds real UTC instants, but DailyActivity.date is
  // keyed by the user's LOCAL calendar day — for a non-UTC user the local day
  // can straddle a UTC midnight. A fixed UTC day window would miss readings from
  // the local evening (now in the next UTC day) and truncate the recompute,
  // overwriting articlesRead. Fetch a window wide enough to contain the whole
  // local day, then keep only the rows whose LOCAL date key matches today's,
  // reusing the same dateKey() helper that derives the stored DailyActivity.date
  // so the recompute always covers exactly the local day whose row we upsert.
  const todayKeyForCount = dateKey(now, tz);
  const progressWindowStart = new Date(now.getTime() - 36 * 60 * 60 * 1000);
  const progressRows = await prisma.readingProgress.findMany({
    where: { userId, updatedAt: { gte: progressWindowStart } },
    select: { articleId: true, updatedAt: true },
  });
  const todayArticleIds = new Set<string>();
  for (const row of progressRows) {
    if (dateKey(row.updatedAt, tz) === todayKeyForCount) {
      todayArticleIds.add(row.articleId);
    }
  }
  const articlesReadToday = todayArticleIds.size;

  // Recent activity for gap detection and shield-earn check
  // (covers today + SHIELD_EARN_STREAK + 1 prior days).
  const lookbackDate = new Date(todayDate.getTime() - (SHIELD_EARN_STREAK + 1) * 86_400_000);
  const recentActivity = await prisma.dailyActivity.findMany({
    where: { userId, date: { gte: lookbackDate } },
    select: { date: true, articlesRead: true },
    take: SHIELD_EARN_STREAK + 3,
  });

  // Build active-date set from stored rows (keys are "YYYY-MM-DD" of local date).
  const activeKeys = new Set<string>(
    recentActivity
      .filter((a) => a.articlesRead > 0)
      .map((a) => a.date.toISOString().slice(0, 10)),
  );

  const todayKey = todayDate.toISOString().slice(0, 10);
  const yesterdayKey = yesterdayDate.toISOString().slice(0, 10);
  const twoDaysAgoKey = twoDaysAgoDate.toISOString().slice(0, 10);

  // --- Shield gap-fill ---
  // Trigger: today is a new active day, yesterday was missed, two days ago was
  // active (exactly 1-day gap), and a shield is available.
  if (
    !activeKeys.has(todayKey) &&
    !activeKeys.has(yesterdayKey) &&
    activeKeys.has(twoDaysAgoKey) &&
    currentShields > 0
  ) {
    await prisma.$transaction([
      prisma.dailyActivity.upsert({
        where: { userId_date: { userId, date: yesterdayDate } },
        update: { articlesRead: 1 },
        create: { userId, date: yesterdayDate, articlesRead: 1 },
      }),
      prisma.profile.update({
        where: { userId },
        data: { streakShields: { decrement: 1 } },
      }),
    ]);
    currentShields--;
    activeKeys.add(yesterdayKey);
  }

  // --- Determine if a shield should be earned (purely in-memory, no DB) ---
  // We tentatively add today to activeKeys so the consecutive-day count
  // correctly includes the upsert we are about to make.
  activeKeys.add(todayKey);

  let shouldEarnShield = false;
  if (currentShields < MAX_SHIELDS && profile !== null) {
    let consecutive = 0;
    for (let i = 0; i < SHIELD_EARN_STREAK; i++) {
      const key = new Date(todayDate.getTime() - i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      if (activeKeys.has(key)) {
        consecutive++;
      } else {
        break;
      }
    }
    shouldEarnShield = consecutive >= SHIELD_EARN_STREAK;
  }

  // --- Upsert today + optional shield earn in one atomic write ---
  // Grouping them prevents a partial failure from leaving articlesRead updated
  // but the shield not awarded (or vice-versa).
  await prisma.$transaction(async (tx) => {
    await tx.dailyActivity.upsert({
      where: { userId_date: { userId, date: todayDate } },
      update: { articlesRead: articlesReadToday },
      create: { userId, date: todayDate, articlesRead: articlesReadToday },
    });
    if (shouldEarnShield) {
      await tx.profile.update({
        where: { userId },
        data: { streakShields: MAX_SHIELDS },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Streak summary
// ---------------------------------------------------------------------------

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
 * Day boundaries use the user's stored IANA timezone (default UTC). Streak
 * rules:
 *  - A day is "active" when articlesRead > 0.
 *  - currentStreak counts consecutive active days ending on today; if today is
 *    not yet active but yesterday is, the streak anchors on yesterday.
 *  - longestStreak is the longest such run in the user's history.
 */
export async function getStreakSummary(userId: string): Promise<StreakSummary> {
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

  // DailyActivity.date is stored as "UTC midnight of the local calendar date",
  // so toISOString().slice(0,10) always gives the correct local date string.
  const activeDates = new Set<string>();
  for (const a of activities) {
    if (a.articlesRead > 0) activeDates.add(a.date.toISOString().slice(0, 10));
  }

  const now = new Date();
  const todayStr = dateKey(now, tz);
  const yesterdayStr = dateKey(new Date(now.getTime() - 86_400_000), tz);

  // Today's progress count
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
    map.set(r.date.toISOString().slice(0, 10), r.articlesRead);
  }
  return buildHeatmapCells(map);
}
