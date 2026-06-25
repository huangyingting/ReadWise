/**
 * Unit tests for src/lib/display-format.ts (REF-083).
 *
 * Pure helper functions — no DB, no network, no mocking needed.
 * Tests cover null / invalid inputs, boundary conditions, and
 * representative happy-path outputs.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  formatShortDate,
  formatMonthYear,
  formatUTCDateLabel,
  formatMediumDate,
  formatShortMonthDay,
  formatDateTime,
  formatWeekdayUTC,
  formatLockAge,
  formatRelativeTime,
  formatUSD,
} from "@/lib/display-format";

// ---------------------------------------------------------------------------
// formatShortDate
// ---------------------------------------------------------------------------

describe("formatShortDate", () => {
  test("formats a Date object", () => {
    const d = new Date("2026-01-15T12:00:00Z");
    assert.equal(formatShortDate(d), "Jan 15, 2026");
  });

  test("formats an ISO string", () => {
    assert.equal(formatShortDate("2026-06-24T00:00:00Z"), "Jun 24, 2026");
  });

  test("returns '—' for null", () => {
    assert.equal(formatShortDate(null), "—");
  });

  test("returns '—' for undefined", () => {
    assert.equal(formatShortDate(undefined), "—");
  });

  test("returns '—' for an invalid date string", () => {
    assert.equal(formatShortDate("not-a-date"), "—");
  });
});

// ---------------------------------------------------------------------------
// formatMonthYear
// ---------------------------------------------------------------------------

describe("formatMonthYear", () => {
  test("formats a Date object", () => {
    const d = new Date("2026-03-01T00:00:00Z");
    assert.equal(formatMonthYear(d), "Mar 2026");
  });

  test("formats an ISO string", () => {
    assert.equal(formatMonthYear("2025-12-15T00:00:00Z"), "Dec 2025");
  });
});

// ---------------------------------------------------------------------------
// formatUTCDateLabel
// ---------------------------------------------------------------------------

describe("formatUTCDateLabel", () => {
  test("formats a YYYY-MM-DD string without timezone shift", () => {
    // Regardless of the host timezone, this should always produce the UTC date.
    assert.equal(formatUTCDateLabel("2026-06-24"), "June 24, 2026");
  });

  test("formats start of year", () => {
    assert.equal(formatUTCDateLabel("2026-01-01"), "January 1, 2026");
  });

  test("formats end of year", () => {
    assert.equal(formatUTCDateLabel("2025-12-31"), "December 31, 2025");
  });
});

// ---------------------------------------------------------------------------
// formatMediumDate
// ---------------------------------------------------------------------------

describe("formatMediumDate", () => {
  test("returns null for null input", () => {
    assert.equal(formatMediumDate(null), null);
  });

  test("formats a Date as a medium date string", () => {
    const d = new Date("2026-06-24T00:00:00Z");
    const result = formatMediumDate(d);
    assert.ok(result !== null, "expected non-null result");
    // Medium date includes the month, day, and year
    assert.ok(result!.includes("2026"), `expected year in: ${result}`);
    assert.ok(result!.includes("24"), `expected day in: ${result}`);
  });
});

// ---------------------------------------------------------------------------
// formatShortMonthDay
// ---------------------------------------------------------------------------

describe("formatShortMonthDay", () => {
  test("formats a Date as short month and day", () => {
    const d = new Date("2026-06-24T00:00:00Z");
    assert.equal(formatShortMonthDay(d), "Jun 24");
  });

  test("formats January 1st", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    assert.equal(formatShortMonthDay(d), "Jan 1");
  });
});

// ---------------------------------------------------------------------------
// formatDateTime
// ---------------------------------------------------------------------------

describe("formatDateTime", () => {
  test("returns '—' for null", () => {
    assert.equal(formatDateTime(null), "—");
  });

  test("returns '—' for undefined", () => {
    assert.equal(formatDateTime(undefined), "—");
  });

  test("returns '—' for an invalid date string", () => {
    assert.equal(formatDateTime("invalid"), "—");
  });

  test("returns a non-empty string for a valid Date", () => {
    const d = new Date("2026-06-24T10:00:00Z");
    const result = formatDateTime(d);
    assert.ok(result.length > 0, "expected non-empty output");
    assert.ok(result !== "—", "expected formatted output, not dash");
  });

  test("accepts an ISO string", () => {
    const result = formatDateTime("2026-06-24T10:00:00Z");
    assert.ok(result.length > 0, "expected non-empty output");
  });
});

// ---------------------------------------------------------------------------
// formatWeekdayUTC
// ---------------------------------------------------------------------------

describe("formatWeekdayUTC", () => {
  test("returns 'Wednesday' for 2026-06-24 (UTC)", () => {
    // 2026-06-24 is a Wednesday in UTC
    const d = new Date("2026-06-24T00:00:00Z");
    assert.equal(formatWeekdayUTC(d), "Wednesday");
  });

  test("returns 'Sunday' for 2026-06-21 (UTC)", () => {
    const d = new Date("2026-06-21T00:00:00Z");
    assert.equal(formatWeekdayUTC(d), "Sunday");
  });
});

// ---------------------------------------------------------------------------
// formatLockAge
// ---------------------------------------------------------------------------

describe("formatLockAge", () => {
  test("returns '—' for null", () => {
    assert.equal(formatLockAge(null), "—");
  });

  test("returns '—' for undefined", () => {
    assert.equal(formatLockAge(undefined), "—");
  });

  test("rounds 30 000 ms to '30s'", () => {
    assert.equal(formatLockAge(30_000), "30s");
  });

  test("59 999 ms rounds to '1m' (Math.round(60/1000=60) exceeds seconds tier)", () => {
    assert.equal(formatLockAge(59_999), "1m");
  });

  test("rounds 90 000 ms to '2m'", () => {
    assert.equal(formatLockAge(90_000), "2m");
  });

  test("3 599 000 ms rounds to '1h' (Math.round(3599/60=60) exceeds minutes tier)", () => {
    assert.equal(formatLockAge(3_599_000), "1h");
  });

  test("rounds 7 200 000 ms to '2h'", () => {
    assert.equal(formatLockAge(7_200_000), "2h");
  });

  test("handles 0 ms", () => {
    assert.equal(formatLockAge(0), "0s");
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
  function isoSecondsAgo(n: number): string {
    return new Date(Date.now() - n * 1000).toISOString();
  }
  function isoMinutesAgo(n: number): string {
    return isoSecondsAgo(n * 60);
  }
  function isoHoursAgo(n: number): string {
    return isoMinutesAgo(n * 60);
  }
  function isoDaysAgo(n: number): string {
    return isoHoursAgo(n * 24);
  }

  test("< 60 s → 'Just now'", () => {
    assert.equal(formatRelativeTime(isoSecondsAgo(30)), "Just now");
  });

  test("59 s → 'Just now'", () => {
    assert.equal(formatRelativeTime(isoSecondsAgo(59)), "Just now");
  });

  test("5 min ago → '5 min ago'", () => {
    assert.equal(formatRelativeTime(isoMinutesAgo(5)), "5 min ago");
  });

  test("59 min ago → '59 min ago'", () => {
    assert.equal(formatRelativeTime(isoMinutesAgo(59)), "59 min ago");
  });

  test("3 h ago → '3h ago'", () => {
    assert.equal(formatRelativeTime(isoHoursAgo(3)), "3h ago");
  });

  test("23 h ago → '23h ago'", () => {
    assert.equal(formatRelativeTime(isoHoursAgo(23)), "23h ago");
  });

  test("exactly 1 day ago → 'Yesterday'", () => {
    assert.equal(formatRelativeTime(isoDaysAgo(1)), "Yesterday");
  });

  test("3 days ago → '3 days ago'", () => {
    assert.equal(formatRelativeTime(isoDaysAgo(3)), "3 days ago");
  });

  test("6 days ago → '6 days ago'", () => {
    assert.equal(formatRelativeTime(isoDaysAgo(6)), "6 days ago");
  });

  test("≥ 7 days → short month+day string", () => {
    const sevenDaysAgo = isoDaysAgo(7);
    const result = formatRelativeTime(sevenDaysAgo);
    // Should not be a relative string
    assert.ok(
      !result.includes("ago") && result !== "Yesterday" && result !== "Just now",
      `expected short date for 7-day-old ISO, got: ${result}`,
    );
  });
});

// ---------------------------------------------------------------------------
// formatUSD
// ---------------------------------------------------------------------------

describe("formatUSD", () => {
  test("values >= 1 use 2 decimal places", () => {
    assert.equal(formatUSD(1.5), "$1.50");
    assert.equal(formatUSD(10), "$10.00");
    assert.equal(formatUSD(1.234), "$1.23");
  });

  test("values < 1 use 4 decimal places", () => {
    assert.equal(formatUSD(0.0012), "$0.0012");
    assert.equal(formatUSD(0.5), "$0.5000");
  });

  test("exactly 1.0 uses 2 decimal places", () => {
    assert.equal(formatUSD(1.0), "$1.00");
  });

  test("zero uses 4 decimal places (< 1 branch)", () => {
    assert.equal(formatUSD(0), "$0.0000");
  });
});
