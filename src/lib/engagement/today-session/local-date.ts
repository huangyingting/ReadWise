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
 *   1. request/browser-supplied timezone, when valid;
 *   2. `Profile.timezone` (the learner's saved IANA zone), when valid;
 *   3. UTC, when neither is a valid IANA zone.
 */

import { prisma } from "@/lib/prisma";
import { resolveTimezone as resolveSharedTimezone } from "@/lib/timezone";
import { dateKey } from "../time";

export { isValidTimezoneString as isValidTimezone } from "@/lib/timezone";

/**
 * Resolve the effective IANA timezone from an optional request/browser zone and
 * the (already loaded) profile zone, falling back to UTC. Pure — no DB access —
 * so it is unit-testable in isolation.
 */
export { resolveTimezone } from "@/lib/timezone";

/** Resolved local-date anchor for a Today session. */
export type LocalDateResolution = {
  /** "YYYY-MM-DD" in the resolved timezone. */
  localDate: string;
  /** The IANA timezone actually used (already validated). */
  timezone: string;
};

async function loadProfileTimezone(userId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return profile?.timezone ?? null;
}

/**
 * Compute the learner's local date + the timezone snapshot used to derive it.
 *
 * Prefers the request/browser zone; falls back to `Profile.timezone`, then UTC.
 * `now` is injectable for deterministic tests.
 */
export async function resolveLocalDate(args: {
  userId: string;
  requestTimezone?: string | null;
  now?: Date;
}): Promise<LocalDateResolution> {
  const { userId, requestTimezone, now = new Date() } = args;

  const timezone = resolveSharedTimezone(requestTimezone, await loadProfileTimezone(userId));
  return { localDate: dateKey(now, timezone), timezone };
}
