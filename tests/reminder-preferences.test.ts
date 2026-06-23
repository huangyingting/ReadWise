/**
 * Tests for src/lib/reminder-preferences.ts (RW-045).
 *
 * Pure scheduling/validation logic + the Prisma accessors (mocked). No real DB.
 */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// Mutable mock state for the prisma reminderPreference delegate.
let mockRows: Record<string, unknown>[] = [];
let upsertCalls: { where: unknown; create: unknown; update: unknown }[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        reminderPreference: {
          findUnique: async (args: { where: { userId: string } }) =>
            mockRows.find((r) => r.userId === args.where.userId) ?? null,
          findMany: async (args: { where?: { userId?: { in?: string[] } } }) => {
            const ids = args.where?.userId?.in;
            return ids ? mockRows.filter((r) => ids.includes(r.userId as string)) : mockRows;
          },
          upsert: async (args: { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }) => {
            upsertCalls.push(args);
            return {
              enabled: true,
              preferredHour: null,
              quietHoursStart: null,
              quietHoursEnd: null,
              timezone: null,
              ...args.create,
              ...args.update,
            };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  mockRows = [];
  upsertCalls = [];
});

// ---------------------------------------------------------------------------
// validateReminderPreference
// ---------------------------------------------------------------------------

test("validateReminderPreference accepts a well-formed partial update", async () => {
  const { validateReminderPreference } = await import("@/lib/reminder-preferences");
  const r = validateReminderPreference({ enabled: true, preferredHour: 9 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.value, { enabled: true, preferredHour: 9 });
});

test("validateReminderPreference allows clearing hours with null", async () => {
  const { validateReminderPreference } = await import("@/lib/reminder-preferences");
  const r = validateReminderPreference({ preferredHour: null });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value.preferredHour, null);
});

test("validateReminderPreference rejects out-of-range hours", async () => {
  const { validateReminderPreference } = await import("@/lib/reminder-preferences");
  assert.equal(validateReminderPreference({ preferredHour: 24 }).ok, false);
  assert.equal(validateReminderPreference({ preferredHour: -1 }).ok, false);
  assert.equal(validateReminderPreference({ preferredHour: 3.5 }).ok, false);
});

test("validateReminderPreference rejects a non-boolean enabled", async () => {
  const { validateReminderPreference } = await import("@/lib/reminder-preferences");
  assert.equal(validateReminderPreference({ enabled: "yes" as unknown }).ok, false);
});

test("validateReminderPreference requires quiet hours to be set together", async () => {
  const { validateReminderPreference } = await import("@/lib/reminder-preferences");
  assert.equal(validateReminderPreference({ quietHoursStart: 22 }).ok, false);
  assert.equal(validateReminderPreference({ quietHoursEnd: 7 }).ok, false);
  assert.equal(
    validateReminderPreference({ quietHoursStart: 22, quietHoursEnd: 7 }).ok,
    true,
  );
});

// ---------------------------------------------------------------------------
// isWithinQuietHours
// ---------------------------------------------------------------------------

test("isWithinQuietHours: simple daytime window", async () => {
  const { isWithinQuietHours } = await import("@/lib/reminder-preferences");
  assert.equal(isWithinQuietHours(10, 9, 17), true);
  assert.equal(isWithinQuietHours(9, 9, 17), true); // inclusive start
  assert.equal(isWithinQuietHours(17, 9, 17), false); // exclusive end
  assert.equal(isWithinQuietHours(8, 9, 17), false);
});

test("isWithinQuietHours: window that wraps past midnight", async () => {
  const { isWithinQuietHours } = await import("@/lib/reminder-preferences");
  assert.equal(isWithinQuietHours(23, 22, 7), true);
  assert.equal(isWithinQuietHours(2, 22, 7), true);
  assert.equal(isWithinQuietHours(7, 22, 7), false); // exclusive end
  assert.equal(isWithinQuietHours(12, 22, 7), false);
});

test("isWithinQuietHours: unset or empty window is never quiet", async () => {
  const { isWithinQuietHours } = await import("@/lib/reminder-preferences");
  assert.equal(isWithinQuietHours(3, null, null), false);
  assert.equal(isWithinQuietHours(3, 5, null), false);
  assert.equal(isWithinQuietHours(5, 5, 5), false); // empty window
});

// ---------------------------------------------------------------------------
// shouldSendNow
// ---------------------------------------------------------------------------

test("shouldSendNow: disabled never sends", async () => {
  const { shouldSendNow } = await import("@/lib/reminder-preferences");
  const r = shouldSendNow(
    { enabled: false, preferredHour: null, quietHoursStart: null, quietHoursEnd: null, timezone: null },
    10,
  );
  assert.deepEqual(r, { send: false, reason: "disabled" });
});

test("shouldSendNow: suppressed during quiet hours", async () => {
  const { shouldSendNow } = await import("@/lib/reminder-preferences");
  const r = shouldSendNow(
    { enabled: true, preferredHour: null, quietHoursStart: 22, quietHoursEnd: 7, timezone: null },
    2,
  );
  assert.equal(r.send, false);
  assert.equal(r.reason, "quiet-hours");
});

test("shouldSendNow: gated to the preferred hour", async () => {
  const { shouldSendNow } = await import("@/lib/reminder-preferences");
  const pref = {
    enabled: true,
    preferredHour: 9,
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: null,
  };
  assert.equal(shouldSendNow(pref, 8).send, false);
  assert.equal(shouldSendNow(pref, 8).reason, "not-preferred-hour");
  assert.equal(shouldSendNow(pref, 9).send, true);
});

test("shouldSendNow: default preference (any hour, enabled) always sends", async () => {
  const { shouldSendNow } = await import("@/lib/reminder-preferences");
  const r = shouldSendNow(
    { enabled: true, preferredHour: null, quietHoursStart: null, quietHoursEnd: null, timezone: null },
    13,
  );
  assert.deepEqual(r, { send: true, reason: "ok" });
});

// ---------------------------------------------------------------------------
// localHourInTimeZone
// ---------------------------------------------------------------------------

test("localHourInTimeZone falls back to UTC when timezone is missing", async () => {
  const { localHourInTimeZone } = await import("@/lib/reminder-preferences");
  const date = new Date("2026-01-01T15:00:00Z");
  assert.equal(localHourInTimeZone(date, null), 15);
  assert.equal(localHourInTimeZone(date, undefined), 15);
});

test("localHourInTimeZone applies a real timezone offset", async () => {
  const { localHourInTimeZone } = await import("@/lib/reminder-preferences");
  const date = new Date("2026-01-01T15:00:00Z");
  // New York is UTC-5 in January → 10:00.
  assert.equal(localHourInTimeZone(date, "America/New_York"), 10);
});

test("localHourInTimeZone falls back to UTC for an invalid timezone", async () => {
  const { localHourInTimeZone } = await import("@/lib/reminder-preferences");
  const date = new Date("2026-01-01T15:00:00Z");
  assert.equal(localHourInTimeZone(date, "Not/AZone"), 15);
});

// ---------------------------------------------------------------------------
// Prisma accessors (mocked)
// ---------------------------------------------------------------------------

test("getReminderPreference returns defaults when no row exists", async () => {
  const { getReminderPreference, DEFAULT_REMINDER_PREFERENCE } = await import(
    "@/lib/reminder-preferences"
  );
  const pref = await getReminderPreference("user-x");
  assert.deepEqual(pref, DEFAULT_REMINDER_PREFERENCE);
});

test("getReminderPreference reflects a stored row", async () => {
  mockRows = [
    {
      userId: "user-x",
      enabled: false,
      preferredHour: 8,
      quietHoursStart: 22,
      quietHoursEnd: 7,
      timezone: "Europe/Berlin",
    },
  ];
  const { getReminderPreference } = await import("@/lib/reminder-preferences");
  const pref = await getReminderPreference("user-x");
  assert.equal(pref.enabled, false);
  assert.equal(pref.preferredHour, 8);
  assert.equal(pref.timezone, "Europe/Berlin");
});

test("getReminderPreferenceMap keys stored rows by userId", async () => {
  mockRows = [
    { userId: "a", enabled: true, preferredHour: null, quietHoursStart: null, quietHoursEnd: null, timezone: null },
    { userId: "b", enabled: false, preferredHour: 9, quietHoursStart: null, quietHoursEnd: null, timezone: null },
  ];
  const { getReminderPreferenceMap } = await import("@/lib/reminder-preferences");
  const map = await getReminderPreferenceMap(["a", "b", "c"]);
  assert.equal(map.size, 2);
  assert.equal(map.get("b")!.preferredHour, 9);
  assert.equal(map.has("c"), false);
});

test("getReminderPreferenceMap short-circuits on an empty id list", async () => {
  const { getReminderPreferenceMap } = await import("@/lib/reminder-preferences");
  const map = await getReminderPreferenceMap([]);
  assert.equal(map.size, 0);
});

test("upsertReminderPreference writes the validated patch", async () => {
  const { upsertReminderPreference } = await import("@/lib/reminder-preferences");
  await upsertReminderPreference("user-x", { enabled: false, preferredHour: 9 });
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0].update, { enabled: false, preferredHour: 9 });
});
