/**
 * Push delivery service.
 *
 * Accepts pre-loaded subscription rows and a serialised payload, then fans out
 * the delivery and updates subscription health via `subscription-health.ts`.
 * Keeping subscriptions pre-loaded at the call site avoids N+1 queries when
 * sending to many users at once (e.g. in the reminder job).
 *
 * Server-only — never import from a Client Component.
 */
import { createLogger } from "@/lib/observability/logger";
import { prisma } from "@/lib/prisma";
import { ensurePushInit, sendWebPushNotification } from "./provider";
import {
  MAX_CONSECUTIVE_FAILURES,
  recordDeliverySuccess,
  recordTransientFailure,
  pruneDeadSubscriptions,
} from "./subscription-health";

const log = createLogger("push");

export interface PushPayload {
  title: string;
  body: string;
  /** Browser notification replacement key used to collapse delivery retries. */
  tag?: string;
  /** URL to open when the notification is clicked (deep-link). */
  url?: string;
  /** Optional icon URL (shown in the notification). */
  icon?: string;
}

export type SubRow = {
  id: string;
  userId?: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Consecutive transient failures recorded so far (RW-045). */
  failureCount?: number;
};

function pushSubscriptionFor(sub: SubRow) {
  return { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
}

function statusCodeFrom(err: unknown): number | undefined {
  return (err as { statusCode?: number }).statusCode;
}

function isExpiredStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

function nextFailureCount(sub: SubRow): number {
  return (sub.failureCount ?? 0) + 1;
}

async function bestEffortHealthUpdate(
  operation: "prune" | "success" | "failure",
  ids: string[],
  update: (ids: string[]) => Promise<void>,
): Promise<void> {
  if (ids.length === 0) return;
  try {
    await update(ids);
  } catch {
    // The external delivery has already been attempted. Retrying the whole job
    // because bookkeeping failed would duplicate successful notifications.
    log.error("push subscription health update failed", {
      failureReason: "push_health_failed",
      operation,
      count: ids.length,
    });
  }
}

/**
 * Sends a push notification to a pre-loaded list of subscriptions.
 * Delivery is tracked per subscription (RW-045): successes reset the failure
 * counter and stamp `lastSuccessAt`; transient failures increment it and stamp
 * `lastFailureAt`; endpoints are pruned on 404/410 OR once they exceed
 * {@link MAX_CONSECUTIVE_FAILURES} consecutive transient failures.
 * Returns the number of successfully delivered pushes.
 */
export async function sendToSubs(subs: SubRow[], payloadStr: string): Promise<number> {
  if (!ensurePushInit()) {
    log.warn("sendToSubs called but VAPID is unconfigured — skipping");
    return 0;
  }
  if (subs.length === 0) return 0;

  const deadIds: string[] = [];
  const successIds: string[] = [];
  const failIds: string[] = [];
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await sendWebPushNotification(pushSubscriptionFor(sub), payloadStr);
        sent++;
        successIds.push(sub.id);
      } catch (err: unknown) {
        const status = statusCodeFrom(err);
        const failures = nextFailureCount(sub);
        if (isExpiredStatus(status)) {
          deadIds.push(sub.id);
          log.info("push subscription expired — pruning", { subId: sub.id, status });
        } else if (failures >= MAX_CONSECUTIVE_FAILURES) {
          deadIds.push(sub.id);
          log.warn("push subscription exceeded failure threshold — pruning", {
            subId: sub.id,
            status: status ?? null,
            failures,
          });
        } else {
          failIds.push(sub.id);
          log.error("failed to send push notification", {
            subId: sub.id,
            status: status ?? null,
            machineReason: "push_delivery_failed",
          });
        }
      }
    }),
  );

  await Promise.all([
    bestEffortHealthUpdate("prune", deadIds, pruneDeadSubscriptions),
    bestEffortHealthUpdate("success", successIds, recordDeliverySuccess),
    bestEffortHealthUpdate("failure", failIds, recordTransientFailure),
  ]);

  return sent;
}

/**
 * Sends a push notification to every active subscription for `userId`.
 * Dead subscriptions (404/410 from the push service) are pruned automatically.
 * Returns the number of successfully delivered pushes.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<number> {
  if (!ensurePushInit()) {
    log.warn("sendPushToUser called but VAPID is unconfigured — skipping");
    return 0;
  }

  const subs = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true, failureCount: true },
  });

  return sendToSubs(subs, JSON.stringify(payload));
}
