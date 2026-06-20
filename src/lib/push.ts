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

const log = createLogger("push");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readVapidConfig(): {
  publicKey: string;
  privateKey: string;
  subject: string;
} | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** Returns true when all three VAPID env vars are present. */
export function isPushConfigured(): boolean {
  return readVapidConfig() !== null;
}

/** The VAPID public key (safe to expose to clients), or null when unconfigured. */
export function vapidPublicKey(): string | null {
  return readVapidConfig()?.publicKey ?? null;
}

// Lazily initialise web-push once so we don't throw at module load time when
// VAPID keys are absent.
let pushInitialised = false;
function ensurePushInit(): boolean {
  if (pushInitialised) return true;
  const cfg = readVapidConfig();
  if (!cfg) return false;
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  pushInitialised = true;
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

type SubRow = { id: string; userId?: string; endpoint: string; p256dh: string; auth: string };

/**
 * Sends a push notification to a pre-loaded list of subscriptions.
 * Dead subscriptions (404 / 410 from the push service) are pruned automatically.
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
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadStr,
        );
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          deadIds.push(sub.id);
          log.info("push subscription expired — pruning", {
            subId: sub.id,
            status,
          });
        } else {
          log.error("failed to send push notification", {
            subId: sub.id,
            error: String(err),
          });
        }
      }
    }),
  );

  if (deadIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: deadIds } } });
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
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  return sendToSubs(subs, JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Daily SRS reminder job
// ---------------------------------------------------------------------------

export interface ReminderResult {
  usersWithDue: number;
  sent: number;
  skipped: number;
}

/**
 * Finds every user who has at least one SRS card due right now AND has an
 * active push subscription, then sends a single "cards due" notification.
 *
 * Designed to be called once per day (e.g. from a cron job or the reminder CLI).
 * Returns counts for observability; returns all-zeros when VAPID unconfigured.
 */
export async function sendDueReminders(): Promise<ReminderResult> {
  if (!isPushConfigured()) {
    log.info("sendDueReminders: VAPID unconfigured — no-op");
    return { usersWithDue: 0, sent: 0, skipped: 0 };
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
    return { usersWithDue: 0, sent: 0, skipped: 0 };
  }

  const dueUserIds = dueGroups.map((g) => g.userId);

  // Batch-load ALL subscriptions for due users in a single query to avoid
  // the N+1 pattern of calling sendPushToUser (which issues its own findMany)
  // once per user.
  const allSubs = await prisma.pushSubscription.findMany({
    where: { userId: { in: dueUserIds } },
    select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
  });

  // Group subscriptions by userId.
  const subsByUser = new Map<string, SubRow[]>();
  for (const sub of allSubs) {
    const list = subsByUser.get(sub.userId) ?? [];
    list.push(sub);
    subsByUser.set(sub.userId, list);
  }

  const subscribedUserIds = [...subsByUser.keys()];

  const result: ReminderResult = {
    usersWithDue: dueGroups.length,
    sent: 0,
    skipped: dueGroups.length - subscribedUserIds.length,
  };

  const dueCountMap = new Map(dueGroups.map((g) => [g.userId, g._count.id]));

  for (const userId of subscribedUserIds) {
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
