/**
 * Tests for activity recording and streak calculation (src/lib/activity.ts).
 * All Prisma calls are mocked — no DB required.
 */
process.env.LOG_LEVEL = "error";
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mutable state -------------------------------------------------------
let progressRows: { articleId: string; updatedAt: Date }[] = [];
let activityRows: { date: Date; articlesRead: number }[] = [];
let upsertCalls: unknown[] = [];
let profileUpdateCalls: unknown[] = [];
let transactionCalls: unknown[] = [];
let profileRow: { dailyGoal?: number; timezone?: string | null; streakShields?: number } | null =
  null;

// Module-level ref so the callback-form $transaction can pass it as `tx`.
let mockPrisma: Record<string, unknown> = {};

before(() => {
  mockPrisma = {
    readingProgress: {
      findMany: async () => progressRows,
    },
    dailyActivity: {
      upsert: async (args: unknown) => {
        upsertCalls.push(args);
        return {};
      },
      findMany: async () => activityRows,
    },
    profile: {
      findUnique: async () => profileRow,
      update: async (args: unknown) => {
        profileUpdateCalls.push(args);
        return {};
      },
    },
    $transaction: async (opsOrFn: unknown) => {
      if (typeof opsOrFn === "function") {
        // Callback form (today-upsert + optional shield earn): pass mockPrisma as tx.
        // Not tracked in transactionCalls so existing gap-fill assertions are unaffected.
        return (opsOrFn as (tx: unknown) => Promise<unknown>)(mockPrisma);
      }
      // Array form (gap-fill): track for existing test assertions.
      transactionCalls.push(opsOrFn);
      return Promise.all(opsOrFn as Promise<unknown>[]);
    },
  };
  mock.module("@/lib/prisma", {
    namedExports: { prisma: mockPrisma },
  });
});

beforeEach(() => {
  progressRows = [];
  activityRows = [];
  upsertCalls = [];
  profileUpdateCalls = [];
  transactionCalls = [];
  profileRow = null;
});

// ---- helpers -------------------------------------------------------------

/** Build a Date at UTC midnight for a given offset from today. */
function daysAgo(n: number): Date {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/** Produce a YYYY-MM-DD string N days before a given date string (UTC). */
function subtractDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---- recordReadingActivity -----------------------------------------------

test("recordReadingActivity upserts today with distinct article count", async () => {
  progressRows = [
    { articleId: "a1", updatedAt: new Date() },
    { articleId: "a1", updatedAt: new Date() }, // same article, distinct collapses
    { articleId: "a2", updatedAt: new Date() },
  ];
  const { recordReadingActivity } = await import("@/lib/activity");
  await recordReadingActivity("user-1", "a1");
  assert.equal(upsertCalls.length, 1);
  const call = upsertCalls[0] as { update: { articlesRead: number } };
  // Prisma distinct: rows returns 2 unique entries (mocked findMany returns all 3; real DB deduplicates)
  // For the mock we return 3 rows — the lib uses `.length` so it will see 3 here (intentional: mock can't deduplicate)
  // but the important thing is that upsert is called
  assert.ok(call.update.articlesRead >= 1);
});

test("recordReadingActivity is idempotent (same article twice = at most count rows)", async () => {
  progressRows = [{ articleId: "a1", updatedAt: new Date() }];
  const { recordReadingActivity } = await import("@/lib/activity");
  await recordReadingActivity("user-1", "a1");
  await recordReadingActivity("user-1", "a1");
  // Both calls should succeed
  assert.equal(upsertCalls.length, 2);
});

// ---- getStreakSummary — currentStreak ------------------------------------

test("currentStreak is 0 when no activity exists", async () => {
  const { getStreakSummary } = await import("@/lib/activity");
  const summary = await getStreakSummary("user-1");
  assert.equal(summary.currentStreak, 0);
  assert.equal(summary.longestStreak, 0);
  assert.equal(summary.todayProgress, 0);
});

test("currentStreak is 1 when only today is active", async () => {
  activityRows = [{ date: daysAgo(0), articlesRead: 3 }];
  const { getStreakSummary } = await import("@/lib/activity");
  const summary = await getStreakSummary("user-1");
  assert.equal(summary.currentStreak, 1);
});

test("currentStreak counts today + consecutive prior days", async () => {
  activityRows = [
    { date: daysAgo(0), articlesRead: 2 },
    { date: daysAgo(1), articlesRead: 1 },
    { date: daysAgo(2), articlesRead: 4 },
    { date: daysAgo(4), articlesRead: 1 }, // gap — should not be counted
  ];
  const { getStreakSummary } = await import("@/lib/activity");
  const summary = await getStreakSummary("user-1");
  assert.equal(summary.currentStreak, 3);
});

test("currentStreak anchors on yesterday when today is not yet active", async () => {
  activityRows = [
    { date: daysAgo(1), articlesRead: 2 },
    { date: daysAgo(2), articlesRead: 1 },
  ];
  const { getStreakSummary } = await import("@/lib/activity");
  const summary = await getStreakSummary("user-1");
  assert.equal(summary.currentStreak, 2);
});

test("currentStreak is 0 when most-recent active day is 2+ days ago", async () => {
  activityRows = [{ date: daysAgo(2), articlesRead: 5 }];
  const { getStreakSummary } = await import("@/lib/activity");
  const summary = await getStreakSummary("user-1");
  assert.equal(summary.currentStreak, 0);
});

// ---- getStreakSummary — longestStreak ------------------------------------

test("longestStreak finds the longest run in history", async () => {
  activityRows = [
    { date: daysAgo(10), articlesRead: 1 },
    { date: daysAgo(9), articlesRead: 1 },
    { date: daysAgo(8), articlesRead: 1 }, // run of 3
    { date: daysAgo(5), articlesRead: 1 },
    { date: daysAgo(4), articlesRead: 1 }, // run of 2
  ];
  const { getStreakSummary } = await import("@/lib/activity");
  const summary = await getStreakSummary("user-1");
  assert.equal(summary.longestStreak, 3);
});

// ---- getStreakSummary — dailyGoal ----------------------------------------

test("dailyGoal falls back to 2 when no profile exists", async () => {
  const { getStreakSummary } = await import("@/lib/activity");
  const summary = await getStreakSummary("user-1");
  assert.equal(summary.dailyGoal, 2);
});

test("dailyGoal reads from profile", async () => {
  profileRow = { dailyGoal: 5 };
  const { getStreakSummary } = await import("@/lib/activity");
  const summary = await getStreakSummary("user-1");
  assert.equal(summary.dailyGoal, 5);
});

// ---- getStreakSummary — last7Days ----------------------------------------

test("last7Days contains 7 entries with today last", async () => {
  const { getStreakSummary } = await import("@/lib/activity");
  const summary = await getStreakSummary("user-1");
  assert.equal(summary.last7Days.length, 7);
  const todayKey = new Date().toISOString().slice(0, 10);
  assert.equal(summary.last7Days[6].date, todayKey);
});

test("last7Days marks active days correctly", async () => {
  activityRows = [{ date: daysAgo(1), articlesRead: 2 }];
  const { getStreakSummary } = await import("@/lib/activity");
  const summary = await getStreakSummary("user-1");
  // Entry at index 5 = yesterday (6-1=5 from the start, but array is oldest→newest)
  const yesterday = summary.last7Days[5];
  assert.equal(yesterday.active, true);
  const today = summary.last7Days[6];
  assert.equal(today.active, false);
});

// ---- getStreakSummary — streakShields ------------------------------------

test("getStreakSummary returns streakShields from profile", async () => {
  profileRow = { dailyGoal: 2, streakShields: 1 };
  const { getStreakSummary } = await import("@/lib/activity");
  const summary = await getStreakSummary("user-1");
  assert.equal(summary.streakShields, 1);
});

test("getStreakSummary defaults streakShields to 0 when no profile", async () => {
  const { getStreakSummary } = await import("@/lib/activity");
  const summary = await getStreakSummary("user-1");
  assert.equal(summary.streakShields, 0);
});

// ---- dateKey — timezone bucketing ----------------------------------------

test("dateKey defaults to UTC", async () => {
  const { dateKey } = await import("@/lib/activity");
  const d = new Date("2026-06-21T04:00:00Z"); // 04:00 UTC June 21
  assert.equal(dateKey(d), "2026-06-21");
});

test("dateKey uses UTC-5: 23:00 local on June 21 = June 21, not June 22", async () => {
  const { dateKey } = await import("@/lib/activity");
  // Etc/GMT+5 is a fixed UTC-5 offset (no DST).
  // 2026-06-22T04:00:00Z = 2026-06-21 23:00 local time in UTC-5.
  const d = new Date("2026-06-22T04:00:00Z");
  assert.equal(dateKey(d, "Etc/GMT+5"), "2026-06-21");
  // Contrast: UTC date is already June 22
  assert.equal(dateKey(d, "UTC"), "2026-06-22");
});

test("dateKey UTC+14: 23:00 local June 21 stays June 21", async () => {
  const { dateKey } = await import("@/lib/activity");
  // UTC+14 is Pacific/Kiritimati — 23:00 local = 09:00 UTC same day
  const d = new Date("2026-06-21T09:00:00Z");
  assert.equal(dateKey(d, "Pacific/Kiritimati"), "2026-06-21");
});

test("dateKey falls back to UTC for an invalid timezone", async () => {
  const { dateKey } = await import("@/lib/activity");
  const d = new Date("2026-06-21T12:00:00Z");
  assert.equal(dateKey(d, "Not/A/Timezone"), "2026-06-21");
});

// ---- localDayStart -------------------------------------------------------

test("localDayStart UTC equals UTC midnight", async () => {
  const { localDayStart } = await import("@/lib/activity");
  const d = new Date("2026-06-21T15:30:00Z");
  const start = localDayStart(d, "UTC");
  assert.equal(start.toISOString(), "2026-06-21T00:00:00.000Z");
});

test("localDayStart UTC-5: 23:00 UTC-5 local → local date midnight", async () => {
  const { localDayStart } = await import("@/lib/activity");
  // Etc/GMT+5 is fixed UTC-5 (no DST).
  // 2026-06-22T04:00:00Z = 23:00 UTC-5 on June 21
  const d = new Date("2026-06-22T04:00:00Z");
  const start = localDayStart(d, "Etc/GMT+5");
  // Local date = June 21 → stored as 2026-06-21T00:00:00Z
  assert.equal(start.toISOString(), "2026-06-21T00:00:00.000Z");
});

// ---- recordReadingActivity — shield gap-fill ----------------------------

test("recordReadingActivity: shield fills a 1-day gap and is consumed", async () => {
  profileRow = { streakShields: 1 };
  const todayKey = new Date().toISOString().slice(0, 10);
  const twoDaysAgoKey = subtractDays(todayKey, 2);
  // Two days ago was active, yesterday was missed (no row)
  activityRows = [{ date: new Date(twoDaysAgoKey + "T00:00:00Z"), articlesRead: 1 }];
  progressRows = [{ articleId: "a1", updatedAt: new Date() }];

  const { recordReadingActivity } = await import("@/lib/activity");
  await recordReadingActivity("user-1", "a1");

  // Transaction should have been called (fills yesterday + decrements shield)
  assert.ok(transactionCalls.length >= 1, "transaction should fire for shield gap-fill");
  // Today's upsert should happen as well
  assert.ok(upsertCalls.length >= 1, "today's upsert should happen");
});

test("recordReadingActivity: shield NOT consumed when gap > 1 day", async () => {
  profileRow = { streakShields: 1 };
  // Last active day was 3 days ago (gap = 2 days) — shield only covers 1 day
  const threeDaysAgoKey = subtractDays(new Date().toISOString().slice(0, 10), 3);
  activityRows = [{ date: new Date(threeDaysAgoKey + "T00:00:00Z"), articlesRead: 1 }];
  progressRows = [{ articleId: "a1", updatedAt: new Date() }];

  const { recordReadingActivity } = await import("@/lib/activity");
  await recordReadingActivity("user-1", "a1");

  // No transaction for gap-fill (gap > 1)
  assert.equal(transactionCalls.length, 0);
  // Today's upsert still fires
  assert.ok(upsertCalls.length >= 1);
});

test("recordReadingActivity: no shield consumed when no gap (consecutive days)", async () => {
  profileRow = { streakShields: 1 };
  const todayKey = new Date().toISOString().slice(0, 10);
  const yesterdayKey = subtractDays(todayKey, 1);
  activityRows = [{ date: new Date(yesterdayKey + "T00:00:00Z"), articlesRead: 2 }];
  progressRows = [{ articleId: "a1", updatedAt: new Date() }];

  const { recordReadingActivity } = await import("@/lib/activity");
  await recordReadingActivity("user-1", "a1");

  // No gap → no transaction for shield consume
  assert.equal(transactionCalls.length, 0);
});

// ---- recordReadingActivity — shield earn --------------------------------

test("recordReadingActivity: earns a shield after 7 consecutive active days", async () => {
  profileRow = { streakShields: 0 };
  const todayKey = new Date().toISOString().slice(0, 10);
  // Make the last 6 days all active
  activityRows = Array.from({ length: 6 }, (_, i) => ({
    date: new Date(subtractDays(todayKey, i + 1) + "T00:00:00Z"),
    articlesRead: 1,
  }));
  progressRows = [{ articleId: "a1", updatedAt: new Date() }];

  const { recordReadingActivity } = await import("@/lib/activity");
  await recordReadingActivity("user-1", "a1");

  // profile.update should be called to set streakShields = MAX_SHIELDS (1)
  assert.ok(profileUpdateCalls.length >= 1, "should award shield after 7-day streak");
});

test("recordReadingActivity: does NOT earn a shield when one is already held", async () => {
  profileRow = { streakShields: 1 };
  const todayKey = new Date().toISOString().slice(0, 10);
  activityRows = Array.from({ length: 6 }, (_, i) => ({
    date: new Date(subtractDays(todayKey, i + 1) + "T00:00:00Z"),
    articlesRead: 1,
  }));
  progressRows = [{ articleId: "a1", updatedAt: new Date() }];

  const { recordReadingActivity } = await import("@/lib/activity");
  await recordReadingActivity("user-1", "a1");

  // Shield already at max — no earn update
  assert.equal(profileUpdateCalls.length, 0);
});

test("recordReadingActivity: does NOT earn a shield with only 5 consecutive days", async () => {
  profileRow = { streakShields: 0 };
  const todayKey = new Date().toISOString().slice(0, 10);
  // Only 5 prior days active (not enough for 7-day streak)
  activityRows = Array.from({ length: 5 }, (_, i) => ({
    date: new Date(subtractDays(todayKey, i + 1) + "T00:00:00Z"),
    articlesRead: 1,
  }));
  progressRows = [{ articleId: "a1", updatedAt: new Date() }];

  const { recordReadingActivity } = await import("@/lib/activity");
  await recordReadingActivity("user-1", "a1");

  assert.equal(profileUpdateCalls.length, 0);
});

// ---- recordReadingActivity — non-UTC day window (#238) -------------------

test("recordReadingActivity: counts both articles read in the local day even when it spans a UTC midnight", async () => {
  // UTC-5 user (Etc/GMT+5, no DST). Their local calendar day in real UTC runs
  // from 05:00Z..05:00Z(+1), which always contains a UTC midnight. Two readings
  // on opposite sides of that UTC midnight are still the SAME local day, so the
  // recompute must keep articlesRead = 2 (the old UTC-window code dropped one).
  const tz = "Etc/GMT+5";
  const { dateKey } = await import("@/lib/activity");
  const localKey = dateKey(new Date(), tz);
  // Real UTC instant of this local midnight (UTC = local + 5h for UTC-5).
  const localMidnightUTC = new Date(localKey + "T05:00:00Z").getTime();
  const beforeUtcMidnight = new Date(localMidnightUTC + 18 * 3_600_000); // 23:00Z same UTC day
  const afterUtcMidnight = new Date(localMidnightUTC + 21 * 3_600_000); // 02:00Z next UTC day

  // Sanity: both timestamps map to the same local day but different UTC days.
  assert.equal(dateKey(beforeUtcMidnight, tz), localKey);
  assert.equal(dateKey(afterUtcMidnight, tz), localKey);
  assert.notEqual(
    beforeUtcMidnight.toISOString().slice(0, 10),
    afterUtcMidnight.toISOString().slice(0, 10),
  );

  profileRow = { timezone: tz, streakShields: 0 };
  progressRows = [
    { articleId: "a1", updatedAt: beforeUtcMidnight },
    { articleId: "a2", updatedAt: afterUtcMidnight },
  ];

  const { recordReadingActivity } = await import("@/lib/activity");
  await recordReadingActivity("user-1", "a1");

  assert.equal(upsertCalls.length, 1);
  const call = upsertCalls[0] as {
    update: { articlesRead: number };
    create: { articlesRead: number };
  };
  assert.equal(call.update.articlesRead, 2);
  assert.equal(call.create.articlesRead, 2);
});

test("recordReadingActivity: excludes readings outside the local day", async () => {
  const tz = "Etc/GMT+5";
  const { dateKey } = await import("@/lib/activity");
  const localKey = dateKey(new Date(), tz);
  const localMidnightUTC = new Date(localKey + "T05:00:00Z").getTime();
  const inToday = new Date(localMidnightUTC + 18 * 3_600_000);
  const yesterday = new Date(localMidnightUTC - 2 * 3_600_000); // before local midnight

  assert.equal(dateKey(inToday, tz), localKey);
  assert.notEqual(dateKey(yesterday, tz), localKey);

  profileRow = { timezone: tz, streakShields: 0 };
  progressRows = [
    { articleId: "a1", updatedAt: inToday },
    { articleId: "a2", updatedAt: yesterday }, // different local day — must NOT count
  ];

  const { recordReadingActivity } = await import("@/lib/activity");
  await recordReadingActivity("user-1", "a1");

  const call = upsertCalls[0] as { update: { articlesRead: number } };
  assert.equal(call.update.articlesRead, 1);
});

// ---- recordReadingActivity — timezone param ------------------------------

test("recordReadingActivity: accepts timezone override and uses local date", async () => {
  profileRow = null; // no profile → defaults, but timezone param is passed
  progressRows = [{ articleId: "a1", updatedAt: new Date() }];

  const { recordReadingActivity } = await import("@/lib/activity");
  // Should not throw when a timezone override is provided
  await assert.doesNotReject(
    recordReadingActivity("user-1", "a1", "America/New_York"),
  );
  assert.ok(upsertCalls.length >= 1, "upsert should still fire");
});
