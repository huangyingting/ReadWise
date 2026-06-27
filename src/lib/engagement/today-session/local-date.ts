/**
 * Today Session — timezone → local-date resolution (#789).
 *
 * @server-only — imports Prisma to read `Profile.timezone`.
 *
 * Produces the learner-local calendar day as "YYYY-MM-DD", aligned with the
 * local-day convention documented in `docs/learning/engagement-analytics.md`
 * (the same `dateKey(date, tz)` bucketing used for DailyActivity). The Today
 * session anchors on the LOCAL calendar date, never a fixed UTC window, so a
 * reader whose evening straddles UTC midnight still gets one stable day.
 *
 * Timezone fallback chain:
 *   1. `Profile.timezone` (the learner's saved IANA zone), when valid;
 *   2. a request/browser-supplied timezone, when valid;
 *   3. UTC, when neither is a valid IANA zone (invalid strings are ignored).
 */

import { prisma } from "@/lib/prisma";
import { dateKey } from "../time";

/**
 * True when `tz` is a usable IANA timezone string. Invalid or empty strings
 * (and non-strings) return false so callers can fall through the chain.
 */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    // Throws RangeError for unknown/invalid zones.
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the effective IANA timezone from the (already loaded) profile zone and
 * an optional request/browser zone, falling back to UTC. Pure — no DB access —
 * so it is unit-testable in isolation.
 */
export function resolveTimezone(
  profileTimezone: string | null | undefined,
  requestTimezone?: string | null,
): string {
  if (isValidTimezone(profileTimezone)) return profileTimezone;
  if (isValidTimezone(requestTimezone)) return requestTimezone;
  return "UTC";
}

/** Resolved local-date anchor for a Today session. */
export type LocalDateResolution = {
  /** "YYYY-MM-DD" in the resolved timezone. */
  localDate: string;
  /** The IANA timezone actually used (already validated). */
  timezone: string;
};

/**
 * Compute the learner's local date + the timezone snapshot used to derive it.
 *
 * Prefers `Profile.timezone`; falls back to a request/browser zone, then UTC.
 * `now` is injectable for deterministic tests.
 */
export async function resolveLocalDate(args: {
  userId: string;
  requestTimezone?: string | null;
  now?: Date;
}): Promise<LocalDateResolution> {
  const { userId, requestTimezone, now = new Date() } = args;

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { timezone: true },
  });

  const timezone = resolveTimezone(profile?.timezone ?? null, requestTimezone);
  return { localDate: dateKey(now, timezone), timezone };
}
