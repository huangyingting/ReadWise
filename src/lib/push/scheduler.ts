/**
 * Reminder scheduler — due-card discovery and push notification dispatch.
 *
 * Finds every user who has at least one SRS card due right now AND has an
 * active push subscription, then sends a single "cards due" notification —
 * respecting each user's reminder preferences (RW-045).
 *
 * Designed to be called hourly (so per-user `preferredHour` can be honoured) or
 * daily. Returns counts for observability; returns all-zeros when VAPID is
 * unconfigured. Batch-oriented: loads all subscriptions for due users in a
 * single query to avoid the N+1 pattern.
 *
 * Server-only — never import from a Client Component.
 */
import { createLogger } from "@/lib/observability/logger";
import { prisma } from "@/lib/prisma";
import {
  getReminderPreferenceMap,
  shouldSendNow,
  localHourInTimeZone,
  DEFAULT_REMINDER_PREFERENCE,
  type ReminderPreference,
} from "@/lib/reminder-preferences";
import { reminder as reminderCopy } from "@/lib/copy/push";
import { isTodaySessionFeatureEnabled } from "@/lib/runtime-config/feature-flags";
import { isPushConfigured } from "./provider";
import { type SubRow, sendToSubs, type PushPayload } from "./delivery";

const log = createLogger("push");

export interface ReminderResult {
  usersWithDue: number;
  sent: number;
  /** Users with due cards but no active subscription. */
  skipped: number;
  /** Users suppressed by their preferences (disabled / quiet hours / off-hour). */
  suppressed: number;
}

export type PushReminderUserResult = {
  userId: string;
  dueCount: number;
  sent: number;
  skipped: boolean;
  suppressed: boolean;
  reason?: "unconfigured" | "no_due_cards" | "no_subscription" | string;
};

/**
 * Sends due-card reminder push notifications to all eligible subscribers.
 * Returns all-zeros when VAPID is unconfigured.
 */
export async function sendDueReminders(): Promise<ReminderResult> {
  if (!isPushConfigured()) {
    log.info("sendDueReminders: VAPID unconfigured — no-op");
    return emptyReminderResult();
  }

  const now = new Date();

  // Find users who have ≥1 due card AND at least one push subscription.
  const dueGroups = await prisma.savedWord.groupBy({
    by: ["userId"],
    where: {
      OR: [{ dueAt: null }, { dueAt: { lte: now } }],
    },
    _count: { id: true },
  });

  if (dueGroups.length === 0) {
    return emptyReminderResult();
  }

  const dueUserIds = dueGroups.map((g) => g.userId);

  // Batch-load ALL subscriptions for due users in a single query to avoid
  // the N+1 pattern of calling sendPushToUser once per user.
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

  const subsByUser = groupSubscriptionsByUser(allSubs);

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

  // Prefer the Today Session deep link + copy when that feature is enabled;
  // otherwise keep the existing due-word reminder target unchanged. The copy
  // stays generic (only a due-word count) — no article, word, or note content.
  const reminderContent = getReminderContent(isTodaySessionFeatureEnabled());

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
    const payload = buildReminderPayload(reminderContent, count);
    const delivered = await sendToSubs(subsByUser.get(userId) ?? [], JSON.stringify(payload));
    if (delivered > 0) result.sent++;
  }

  log.info("sendDueReminders complete", {
    usersWithDue: result.usersWithDue,
    sent: result.sent,
    skipped: result.skipped,
    suppressed: result.suppressed,
  });
  return result;
}

/**
 * Sends the due-card reminder for a single user. Used by durable PUSH_REMINDER
 * jobs, while {@link sendDueReminders} remains the batch scheduler entry point.
 */
export async function sendPushReminderForUser(userId: string): Promise<PushReminderUserResult> {
  if (!isPushConfigured()) {
    log.info("sendPushReminderForUser: VAPID unconfigured — no-op", { userId });
    return skippedUserReminder(userId, "unconfigured");
  }

  const now = new Date();
  const dueCount = await prisma.savedWord.count({
    where: {
      userId,
      OR: [{ dueAt: null }, { dueAt: { lte: now } }],
    },
  });
  if (dueCount === 0) {
    return skippedUserReminder(userId, "no_due_cards");
  }

  const subs = await prisma.pushSubscription.findMany({
    where: { userId },
    select: {
      id: true,
      userId: true,
      endpoint: true,
      p256dh: true,
      auth: true,
      failureCount: true,
    },
  });
  if (subs.length === 0) {
    return skippedUserReminder(userId, "no_subscription", dueCount);
  }

  const [prefMap, profile] = await Promise.all([
    getReminderPreferenceMap([userId]),
    prisma.profile.findUnique({
      where: { userId },
      select: { timezone: true },
    }),
  ]);
  const pref: ReminderPreference = prefMap.get(userId) ?? {
    ...DEFAULT_REMINDER_PREFERENCE,
  };
  const localHour = localHourInTimeZone(now, pref.timezone ?? profile?.timezone ?? null);
  const decision = shouldSendNow(pref, localHour);
  if (!decision.send) {
    log.info("reminder suppressed by preference", {
      userId,
      reason: decision.reason,
      localHour,
    });
    return {
      userId,
      dueCount,
      sent: 0,
      skipped: false,
      suppressed: true,
      reason: decision.reason,
    };
  }

  const payload = buildReminderPayload(
    getReminderContent(isTodaySessionFeatureEnabled()),
    dueCount,
  );
  const sent = await sendToSubs(subs, JSON.stringify(payload));
  return { userId, dueCount, sent, skipped: false, suppressed: false };
}

function emptyReminderResult(): ReminderResult {
  return { usersWithDue: 0, sent: 0, skipped: 0, suppressed: 0 };
}

function skippedUserReminder(
  userId: string,
  reason: PushReminderUserResult["reason"],
  dueCount = 0,
): PushReminderUserResult {
  return { userId, dueCount, sent: 0, skipped: true, suppressed: false, reason };
}

type UserSubscription = SubRow & { userId: string };

function groupSubscriptionsByUser(subscriptions: UserSubscription[]): Map<string, SubRow[]> {
  const subsByUser = new Map<string, SubRow[]>();
  for (const sub of subscriptions) {
    const list = subsByUser.get(sub.userId) ?? [];
    list.push(sub);
    subsByUser.set(sub.userId, list);
  }
  return subsByUser;
}

type ReminderContent = {
  title: string;
  body: (count: number) => string;
  url: string;
};

function getReminderContent(todaySession: boolean): ReminderContent {
  return {
    title: todaySession ? reminderCopy.todayTitle : reminderCopy.title,
    body: todaySession ? reminderCopy.todayBody : reminderCopy.body,
    url: todaySession ? reminderCopy.todayUrl : reminderCopy.url,
  };
}

function buildReminderPayload(content: ReminderContent, count: number): PushPayload {
  return {
    title: content.title,
    body: content.body(count),
    url: content.url,
    icon: reminderCopy.icon,
  };
}
