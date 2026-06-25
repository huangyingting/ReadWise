/**
 * Focused tests for the pure engagement time helpers (engagement/time.ts).
 *
 * These tests import directly from the sub-module and require NO Prisma mock,
 * demonstrating that the date/timezone logic is fully independent of the DB.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateKey, localDayStart } from "@/lib/engagement/time";

// ---- dateKey ---------------------------------------------------------------

test("engagement/time: dateKey defaults to UTC", () => {
  const d = new Date("2026-06-21T04:00:00Z");
  assert.equal(dateKey(d), "2026-06-21");
});

test("engagement/time: dateKey UTC-5: 23:00 local on June 21 = June 21, not June 22", () => {
  // 2026-06-22T04:00:00Z = 23:00 local in Etc/GMT+5 (fixed UTC-5, no DST)
  const d = new Date("2026-06-22T04:00:00Z");
  assert.equal(dateKey(d, "Etc/GMT+5"), "2026-06-21");
  assert.equal(dateKey(d, "UTC"), "2026-06-22");
});

test("engagement/time: dateKey UTC+14: 23:00 local June 21 stays June 21", () => {
  // Pacific/Kiritimati is UTC+14; 09:00Z = 23:00 local on June 21
  const d = new Date("2026-06-21T09:00:00Z");
  assert.equal(dateKey(d, "Pacific/Kiritimati"), "2026-06-21");
});

test("engagement/time: dateKey falls back to UTC for an invalid timezone", () => {
  const d = new Date("2026-06-21T12:00:00Z");
  assert.equal(dateKey(d, "Not/A/Timezone"), "2026-06-21");
});

// ---- localDayStart ---------------------------------------------------------

test("engagement/time: localDayStart UTC returns UTC midnight", () => {
  const d = new Date("2026-06-21T15:30:00Z");
  const start = localDayStart(d, "UTC");
  assert.equal(start.toISOString(), "2026-06-21T00:00:00.000Z");
});

test("engagement/time: localDayStart UTC-5: 23:00 local → local midnight stored as UTC", () => {
  // 2026-06-22T04:00:00Z = 23:00 local in Etc/GMT+5
  const d = new Date("2026-06-22T04:00:00Z");
  const start = localDayStart(d, "Etc/GMT+5");
  // Local date = June 21 → stored as 2026-06-21T00:00:00Z
  assert.equal(start.toISOString(), "2026-06-21T00:00:00.000Z");
});

test("engagement/time: localDayStart UTC+9 maps to correct local midnight", () => {
  // 2026-06-21T01:00:00Z = 10:00 local in Asia/Tokyo (UTC+9)
  const d = new Date("2026-06-21T01:00:00Z");
  const start = localDayStart(d, "Asia/Tokyo");
  assert.equal(start.toISOString(), "2026-06-21T00:00:00.000Z");
});

test("engagement/time: readings on opposite sides of UTC midnight share a local day (UTC-5)", () => {
  // For a UTC-5 user, their local calendar day spans 05:00Z–05:00Z(+1).
  // A reading at 23:00Z one UTC day and 03:00Z the next are the SAME local day.
  const localKey = dateKey(new Date(), "Etc/GMT+5");
  const localMidnightUTC = new Date(localKey + "T05:00:00Z").getTime();
  const beforeUtcMidnight = new Date(localMidnightUTC + 18 * 3_600_000); // 23:00Z
  const afterUtcMidnight = new Date(localMidnightUTC + 21 * 3_600_000);  // 02:00Z next UTC day

  assert.equal(dateKey(beforeUtcMidnight, "Etc/GMT+5"), localKey);
  assert.equal(dateKey(afterUtcMidnight, "Etc/GMT+5"), localKey);
  // But their UTC dates differ
  assert.notEqual(
    beforeUtcMidnight.toISOString().slice(0, 10),
    afterUtcMidnight.toISOString().slice(0, 10),
  );
});
