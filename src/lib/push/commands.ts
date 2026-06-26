/**
 * Push subscription commands — service layer (RW-045 / R2CI-8).
 *
 * DB-backed write operations for push subscriptions. Keeps Prisma access
 * out of the route layer, mirroring how {@link ./delivery} owns delivery DB
 * access and how job commands live in the jobs service layer.
 */

import { prisma } from "@/lib/prisma";
import { type DomainResult, ok, conflict } from "@/lib/result";

const MAX_SUBSCRIPTIONS_PER_USER = 10;

/**
 * Saves (or updates) a browser PushSubscription for the given user.
 * Upserts by endpoint so re-subscribing is idempotent.
 * Enforces a per-user cap of {@link MAX_SUBSCRIPTIONS_PER_USER} unique endpoints.
 */
export async function subscribePush(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
): Promise<DomainResult> {
  // Enforce per-user subscription cap (upserts on existing endpoint don't count).
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint },
    select: { userId: true },
  });
  if (!existing) {
    const count = await prisma.pushSubscription.count({ where: { userId } });
    if (count >= MAX_SUBSCRIPTIONS_PER_USER) {
      return conflict("Too many subscriptions");
    }
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { p256dh, auth, userId },
    create: { userId, endpoint, p256dh, auth },
  });

  return ok();
}
