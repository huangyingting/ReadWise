/**
 * Reading-activity recording service for the engagement subsystem.
 *
 * `recordReadingActivity` is called as a side-effect from `saveProgress` — it
 * recomputes the distinct article count from ReadingProgress (idempotent: same
 * article saved twice in one day still counts once) and upserts the
 * DailyActivity row. It also handles streak-shield gap-fill and earn logic.
 *
 * Day boundaries are computed in the user's IANA timezone. DailyActivity.date
 * is stored as "UTC midnight of the user's local calendar date", so
 * ReadingProgress.updatedAt (a real UTC instant) must be bucketed via
 * dateKey(updatedAt, tz) — not a UTC day window — to correctly attribute
 * readings that straddle a UTC midnight to the right local day.
 */

import { prisma } from "@/lib/prisma";
import { dateKey, localDayStart } from "./time";
import { SHIELD_EARN_STREAK, MAX_SHIELDS } from "./streak";

const DAY_MS = 86_400_000;
const PROGRESS_COUNT_LOOKBACK_MS = 36 * 60 * 60 * 1000;

type RecentActivityRow = {
  date: Date;
  articlesRead: number;
};

function storedDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function countDistinctArticlesReadToday(
  userId: string,
  now: Date,
  timezone: string,
): Promise<number> {
  // ReadingProgress.updatedAt holds real UTC instants, but DailyActivity.date is
  // keyed by the user's LOCAL calendar day — for a non-UTC user the local day
  // can straddle a UTC midnight. A fixed UTC day window would miss readings from
  // the local evening (now in the next UTC day) and truncate the recompute,
  // overwriting articlesRead. Fetch a window wide enough to contain the whole
  // local day, then keep only the rows whose LOCAL date key matches today's,
  // reusing the same dateKey() helper that derives the stored DailyActivity.date
  // so the recompute always covers exactly the local day whose row we upsert.
  const todayKeyForCount = dateKey(now, timezone);
  const progressWindowStart = new Date(now.getTime() - PROGRESS_COUNT_LOOKBACK_MS);
  const progressRows = await prisma.readingProgress.findMany({
    where: { userId, updatedAt: { gte: progressWindowStart } },
    select: { articleId: true, updatedAt: true },
  });

  const todayArticleIds = new Set<string>();
  for (const row of progressRows) {
    if (dateKey(row.updatedAt, timezone) === todayKeyForCount) {
      todayArticleIds.add(row.articleId);
    }
  }
  return todayArticleIds.size;
}

function activeDateKeys(recentActivity: RecentActivityRow[]): Set<string> {
  return new Set(
    recentActivity
      .filter((activity) => activity.articlesRead > 0)
      .map((activity) => storedDateKey(activity.date)),
  );
}

function hasShieldFillableGap(args: {
  activeKeys: Set<string>;
  currentShields: number;
  todayKey: string;
  twoDaysAgoKey: string;
  yesterdayKey: string;
}): boolean {
  return (
    !args.activeKeys.has(args.todayKey) &&
    !args.activeKeys.has(args.yesterdayKey) &&
    args.activeKeys.has(args.twoDaysAgoKey) &&
    args.currentShields > 0
  );
}

function shouldEarnShield(args: {
  activeKeys: Set<string>;
  currentShields: number;
  profileExists: boolean;
  todayDate: Date;
}): boolean {
  if (args.currentShields >= MAX_SHIELDS || !args.profileExists) {
    return false;
  }

  let consecutive = 0;
  for (let i = 0; i < SHIELD_EARN_STREAK; i++) {
    const key = storedDateKey(new Date(args.todayDate.getTime() - i * DAY_MS));
    if (args.activeKeys.has(key)) {
      consecutive++;
    } else {
      break;
    }
  }
  return consecutive >= SHIELD_EARN_STREAK;
}

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
  now?: Date,
): Promise<void> {
  now = now ?? new Date();

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { timezone: true, streakShields: true },
  });

  const tz = timezone ?? profile?.timezone ?? "UTC";
  let currentShields = profile?.streakShields ?? 0;

  const todayDate = localDayStart(now, tz);
  const yesterdayDate = new Date(todayDate.getTime() - DAY_MS);
  const twoDaysAgoDate = new Date(todayDate.getTime() - 2 * DAY_MS);

  const articlesReadToday = await countDistinctArticlesReadToday(userId, now, tz);

  // Recent activity for gap detection and shield-earn check
  // (covers today + SHIELD_EARN_STREAK + 1 prior days).
  const lookbackDate = new Date(
    todayDate.getTime() - (SHIELD_EARN_STREAK + 1) * DAY_MS,
  );
  const recentActivity = await prisma.dailyActivity.findMany({
    where: { userId, date: { gte: lookbackDate } },
    select: { date: true, articlesRead: true },
    take: SHIELD_EARN_STREAK + 3,
  });

  // Build active-date set from stored rows (keys are "YYYY-MM-DD" of local date).
  const activeKeys = activeDateKeys(recentActivity);

  const todayKey = storedDateKey(todayDate);
  const yesterdayKey = storedDateKey(yesterdayDate);
  const twoDaysAgoKey = storedDateKey(twoDaysAgoDate);

  // --- Shield gap-fill ---
  // Trigger: today is a new active day, yesterday was missed, two days ago was
  // active (exactly 1-day gap), and a shield is available.
  if (hasShieldFillableGap({
    activeKeys,
    currentShields,
    todayKey,
    twoDaysAgoKey,
    yesterdayKey,
  })) {
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

  const earnsShield = shouldEarnShield({
    activeKeys,
    currentShields,
    profileExists: profile !== null,
    todayDate,
  });

  // --- Upsert today + optional shield earn in one atomic write ---
  // Grouping them prevents a partial failure from leaving articlesRead updated
  // but the shield not awarded (or vice-versa).
  await prisma.$transaction(async (tx) => {
    await tx.dailyActivity.upsert({
      where: { userId_date: { userId, date: todayDate } },
      update: { articlesRead: articlesReadToday },
      create: { userId, date: todayDate, articlesRead: articlesReadToday },
    });
    if (earnsShield) {
      await tx.profile.update({
        where: { userId },
        data: { streakShields: MAX_SHIELDS },
      });
    }
  });
}
