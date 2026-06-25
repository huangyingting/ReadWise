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
import { createLogger } from "@/lib/logger";
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
        await sendWebPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadStr,
        );
        sent++;
        successIds.push(sub.id);
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          deadIds.push(sub.id);
          log.info("push subscription expired — pruning", { subId: sub.id, status });
        } else if ((sub.failureCount ?? 0) + 1 >= MAX_CONSECUTIVE_FAILURES) {
          deadIds.push(sub.id);
          log.warn("push subscription exceeded failure threshold — pruning", {
            subId: sub.id,
            status: status ?? null,
            failures: (sub.failureCount ?? 0) + 1,
          });
        } else {
          failIds.push(sub.id);
          log.error("failed to send push notification", {
            subId: sub.id,
            status: status ?? null,
            error: String(err),
          });
        }
      }
    }),
  );

  await pruneDeadSubscriptions(deadIds);
  await recordDeliverySuccess(successIds);
  await recordTransientFailure(failIds);

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
