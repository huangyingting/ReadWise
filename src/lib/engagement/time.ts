/**
 * Pure date/timezone helpers for the engagement subsystem.
 *
 * DailyActivity.date is stored as "UTC midnight of the user's local calendar
 * date" (local-day convention). ReadingProgress.updatedAt is a real UTC
 * instant. These helpers bridge that gap consistently.
 *
 * No Prisma dependency — safe to import in pure-function tests.
 */

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
