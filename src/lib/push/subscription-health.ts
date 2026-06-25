/**
 * Push subscription health tracking (RW-045).
 *
 * Manages failure counters and endpoint pruning for `PushSubscription` rows:
 *   - Successful delivery resets the failure counter and stamps `lastSuccessAt`.
 *   - Transient failures increment the counter and stamp `lastFailureAt`.
 *   - 404/410 responses and endpoints that exceed the consecutive-failure
 *     threshold are pruned from the database.
 *
 * Server-only — never import from a Client Component.
 */
import { prisma } from "@/lib/prisma";

/**
 * Consecutive transient failures tolerated before an endpoint is pruned even
 * without an explicit 404/410. Guards against endpoints that are permanently
 * unreachable but never return a clean "gone" status (RW-045).
 */
export const MAX_CONSECUTIVE_FAILURES = 8;

/** Records a successful delivery: resets failure count, stamps lastSuccessAt. */
export async function recordDeliverySuccess(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.pushSubscription.updateMany({
    where: { id: { in: ids } },
    data: { failureCount: 0, lastSuccessAt: new Date() },
  });
}

/** Records a transient failure: increments failure count, stamps lastFailureAt. */
export async function recordTransientFailure(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.pushSubscription.updateMany({
    where: { id: { in: ids } },
    data: { failureCount: { increment: 1 }, lastFailureAt: new Date() },
  });
}

/** Prunes dead/expired subscriptions by deleting their database rows. */
export async function pruneDeadSubscriptions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.pushSubscription.deleteMany({ where: { id: { in: ids } } });
}
