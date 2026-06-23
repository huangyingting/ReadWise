/**
 * Web Push / VAPID support for SRS review reminders.
 *
 * Follows the same graceful-fallback convention as AI/Speech:
 *   `isPushConfigured()` → false when VAPID env vars are absent.
 *   All public functions are no-ops (or return early) when unconfigured.
 *
 * Server-only — never import this from a Client Component or the SW script.
 */
import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { pushConfig } from "@/lib/config";
import {
  getReminderPreferenceMap,
  shouldSendNow,
  localHourInTimeZone,
  DEFAULT_REMINDER_PREFERENCE,
  type ReminderPreference,
} from "@/lib/reminder-preferences";

const log = createLogger("push");

/**
 * Consecutive transient failures tolerated before an endpoint is pruned even
 * without an explicit 404/410. Guards against endpoints that are permanently
 * unreachable but never return a clean "gone" status (RW-045).
 */
const MAX_CONSECUTIVE_FAILURES = 8;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readVapidConfig(): {
  publicKey: string;
  privateKey: string;
  subject: string;
} | null {
  return pushConfig.get();
}

/** Returns true when VAPID env vars are present and accepted by web-push. */
export function isPushConfigured(): boolean {
  return pushConfig.isConfigured() && ensurePushInit();
}

/** The VAPID public key (safe to expose to clients), or null when unconfigured. */
export function vapidPublicKey(): string | null {
  return readVapidConfig()?.publicKey ?? null;
}

// Lazily initialise web-push once so we don't throw at module load time when
// VAPID keys are absent.
let pushInitialised = false;
let pushInitKey: string | null = null;

function pushConfigKey(cfg: NonNullable<ReturnType<typeof readVapidConfig>>): string {
  return `${cfg.subject}\n${cfg.publicKey}\n${cfg.privateKey}`;
}

function ensurePushInit(): boolean {
  const cfg = readVapidConfig();
  if (!cfg) return false;
  const key = pushConfigKey(cfg);
  if (pushInitialised && pushInitKey === key) return true;

  try {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    pushInitialised = true;
    pushInitKey = key;
  } catch (err) {
    pushInitialised = false;
    pushInitKey = null;
    log.warn("invalid VAPID configuration — push disabled", {
      error: String(err),
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Push payload type
// ---------------------------------------------------------------------------

export interface PushPayload {
  title: string;
  body: string;
  /** URL to open when the notification is clicked (deep-link). */
  url?: string;
  /** Optional icon URL (shown in the notification). */
  icon?: string;
}

// ---------------------------------------------------------------------------
// Send to one user
// ---------------------------------------------------------------------------

type SubRow = {
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
 *
 * Used internally by both `sendPushToUser` and the batched `sendDueReminders`
 * to avoid re-fetching subscriptions inside a loop.
 */
async function sendToSubs(subs: SubRow[], payloadStr: string): Promise<number> {
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
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadStr,
        );
        sent++;
        successIds.push(sub.id);
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          deadIds.push(sub.id);
          log.info("push subscription expired — pruning", {
            subId: sub.id,
            status,
          });
        } else if ((sub.failureCount ?? 0) + 1 >= MAX_CONSECUTIVE_FAILURES) {
          // Too many consecutive failures — prune the unhealthy endpoint.
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

  const now = new Date();
  if (deadIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: deadIds } } });
  }
  if (successIds.length > 0) {
    await prisma.pushSubscription.updateMany({
      where: { id: { in: successIds } },
      data: { failureCount: 0, lastSuccessAt: now },
    });
  }
  if (failIds.length > 0) {
    await prisma.pushSubscription.updateMany({
      where: { id: { in: failIds } },
      data: { failureCount: { increment: 1 }, lastFailureAt: now },
    });
  }

  return sent;
}

/**
 * Sends a push notification to every active subscription for `userId`.
 * Dead subscriptions (404 / 410 from the push service) are pruned automatically.
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

// ---------------------------------------------------------------------------
// Daily SRS reminder job
// ---------------------------------------------------------------------------

export interface ReminderResult {
  usersWithDue: number;
  sent: number;
  /** Users with due cards but no active subscription. */
  skipped: number;
  /** Users suppressed by their preferences (disabled / quiet hours / off-hour). */
  suppressed: number;
}

/**
 * Finds every user who has at least one SRS card due right now AND has an
 * active push subscription, then sends a single "cards due" notification —
 * respecting each user's reminder preferences (RW-045): disabled users, those
 * inside their quiet hours, and those whose preferred send-hour isn't the
 * current local hour are suppressed (not sent).
 *
 * Designed to be called hourly (so per-user `preferredHour` can be honoured) or
 * daily. Returns counts for observability; returns all-zeros when VAPID
 * unconfigured.
 */
export async function sendDueReminders(): Promise<ReminderResult> {
  if (!isPushConfigured()) {
    log.info("sendDueReminders: VAPID unconfigured — no-op");
    return { usersWithDue: 0, sent: 0, skipped: 0, suppressed: 0 };
  }

  const now = new Date();

  // Find users who have ≥1 due card AND at least one push subscription.
  // We use a raw groupBy to count due cards per user, then intersect with
  // users who have subscriptions.
  const dueGroups = await prisma.savedWord.groupBy({
    by: ["userId"],
    where: {
      OR: [{ dueAt: null }, { dueAt: { lte: now } }],
    },
    _count: { id: true },
  });

  if (dueGroups.length === 0) {
    return { usersWithDue: 0, sent: 0, skipped: 0, suppressed: 0 };
  }

  const dueUserIds = dueGroups.map((g) => g.userId);

  // Batch-load ALL subscriptions for due users in a single query to avoid
  // the N+1 pattern of calling sendPushToUser (which issues its own findMany)
  // once per user.
  const allSubs = await prisma.pushSubscription.findMany({
    where: { userId: { in: dueUserIds } },
    select: {
      id: true,
      userId: true,
      endpoint: true,
      p256dh: true,
      auth: true,
      failureCount: true,
    },
  });

  // Group subscriptions by userId.
  const subsByUser = new Map<string, SubRow[]>();
  for (const sub of allSubs) {
    const list = subsByUser.get(sub.userId) ?? [];
    list.push(sub);
    subsByUser.set(sub.userId, list);
  }

  const subscribedUserIds = [...subsByUser.keys()];

  // Load preferences + profile timezones for the subscribed cohort (RW-045).
  const [prefMap, profiles] = await Promise.all([
    getReminderPreferenceMap(subscribedUserIds),
    prisma.profile.findMany({
      where: { userId: { in: subscribedUserIds } },
      select: { userId: true, timezone: true },
    }),
  ]);
  const tzByUser = new Map(profiles.map((p) => [p.userId, p.timezone]));

  const result: ReminderResult = {
    usersWithDue: dueGroups.length,
    sent: 0,
    skipped: dueGroups.length - subscribedUserIds.length,
    suppressed: 0,
  };

  const dueCountMap = new Map(dueGroups.map((g) => [g.userId, g._count.id]));

  for (const userId of subscribedUserIds) {
    const pref: ReminderPreference = prefMap.get(userId) ?? {
      ...DEFAULT_REMINDER_PREFERENCE,
    };
    const tz = pref.timezone ?? tzByUser.get(userId) ?? null;
    const localHour = localHourInTimeZone(now, tz);
    const decision = shouldSendNow(pref, localHour);
    if (!decision.send) {
      result.suppressed++;
      log.info("reminder suppressed by preference", {
        userId,
        reason: decision.reason,
        localHour,
      });
      continue;
    }

    const count = dueCountMap.get(userId) ?? 0;
    const payload: PushPayload = {
      title: "Time to review! 📚",
      body:
        count === 1
          ? "You have 1 word due for review in ReadWise."
          : `You have ${count} words due for review in ReadWise.`,
      url: "/study",
      icon: "/icons/icon-192.png",
    };
    const delivered = await sendToSubs(subsByUser.get(userId) ?? [], JSON.stringify(payload));
    if (delivered > 0) result.sent++;
  }

  log.info("sendDueReminders complete", result as unknown as Record<string, unknown>);
  return result;
}
