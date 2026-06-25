/**
 * Analytics event retention and erasure (REF-049).
 *
 * Implements the privacy/retention lifecycle for the analytics event stream:
 *   - {@link pruneOldEvents} — time-based retention window (scheduled job/CLI).
 *   - {@link deleteEventsForUser} — explicit per-user GDPR/privacy erasure.
 *
 * Because `userId` is a plain string (NOT an FK), events do NOT cascade with
 * user deletion — call {@link deleteEventsForUser} explicitly when erasing a
 * user's data.
 */
import { prisma } from "@/lib/prisma";
import { analyticsRetentionDays } from "@/lib/runtime-config/analytics";

type RetentionClient = Pick<typeof prisma, "analyticsEvent">;

/**
 * Deletes analytics events older than the retention window (privacy/retention,
 * RW-051). `olderThanDays` defaults to {@link analyticsRetentionDays}. Returns
 * the number of rows removed. Intended to be run from a scheduled job/CLI.
 */
export async function pruneOldEvents(
  olderThanDays: number = analyticsRetentionDays(),
  client: RetentionClient = prisma,
  now: Date = new Date(),
): Promise<number> {
  const days =
    Number.isFinite(olderThanDays) && olderThanDays > 0
      ? Math.floor(olderThanDays)
      : analyticsRetentionDays();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const result = await client.analyticsEvent.deleteMany({
    where: { occurredAt: { lt: cutoff } },
  });
  return result.count;
}

/**
 * Deletes ALL analytics events for a user (privacy / GDPR erasure, RW-051).
 * Because `userId` is a plain string (not an FK), events do NOT cascade with
 * the user — call this explicitly when erasing a user's data. Returns the
 * number of rows removed.
 */
export async function deleteEventsForUser(
  userId: string,
  client: RetentionClient = prisma,
): Promise<number> {
  if (!userId) return 0;
  const result = await client.analyticsEvent.deleteMany({ where: { userId } });
  return result.count;
}
