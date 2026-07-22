/**
 * Assignment due/overdue push reminder scheduler.
 *
 * Finds every student who has at least one due or overdue assignment that they
 * have not yet completed, then sends a single "assignments due" push notification
 * — respecting each student's reminder preferences (quiet hours, disabled, etc.).
 *
 * Reuses the full existing push stack (VAPID gate, subscription batch-load,
 * reminder preferences, dead-sub pruning) so assignment reminders behave
 * identically to SRS due-card reminders.
 *
 * `sendAssignmentReminderToStudent()` is the reusable single-student primitive
 * that GAP-5 (teacher nudge) will call directly.
 *
 * Server-only — never import from a Client Component.
 */
import { AssignmentStatus } from "@prisma/client";
import { createLogger } from "@/lib/observability/logger";
import { prisma } from "@/lib/prisma";
import {
  getReminderPreferenceMap,
  shouldSendNow,
  localHourInTimeZone,
  DEFAULT_REMINDER_PREFERENCE,
  type ReminderPreference,
} from "@/lib/reminder-preferences";
import { reminderAssignment } from "@/lib/copy/push";
import { assignmentVisibleToStudentWhere, effectiveStudentIds } from "@/lib/classroom/targeting";
import { isPushConfigured } from "./provider";
import { type SubRow, sendToSubs, type PushPayload } from "./delivery";

const log = createLogger("push");

export type AssignmentReminderResult = {
  studentsWithDue: number;
  sent: number;
  /** Students with due assignments but no active subscription. */
  skipped: number;
  /** Students suppressed by their preferences (disabled / quiet hours). */
  suppressed: number;
};

export type AssignmentReminderUserResult = {
  studentId: string;
  dueCount: number;
  sent: number;
  skipped: boolean;
  suppressed: boolean;
  reason?: string;
};

/**
 * Returns the number of due/overdue, not-yet-completed assignments for a student.
 */
export async function countDueAssignmentsForStudent(
  studentId: string,
  now: Date = new Date(),
): Promise<number> {
  return prisma.assignment.count({
    where: {
      dueDate: { not: null, lte: now },
      classroom: { members: { some: { userId: studentId, role: "Student" } } },
      ...assignmentVisibleToStudentWhere(studentId),
      completions: { none: { studentId, status: AssignmentStatus.COMPLETED } },
    },
  });
}

/**
 * Sends an assignment due reminder to a single student.
 * Reusable primitive — GAP-5 teacher nudge will call this directly.
 */
export async function sendAssignmentReminderToStudent(
  studentId: string,
): Promise<AssignmentReminderUserResult> {
  if (!isPushConfigured()) {
    log.info("sendAssignmentReminderToStudent: VAPID unconfigured — no-op", { studentId });
    return skippedStudentReminder(studentId, "unconfigured");
  }

  const now = new Date();
  const dueCount = await countDueAssignmentsForStudent(studentId, now);
  if (dueCount === 0) {
    return skippedStudentReminder(studentId, "no_due_assignments");
  }

  const subs = await prisma.pushSubscription.findMany({
    where: { userId: studentId },
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
    return skippedStudentReminder(studentId, "no_subscription", dueCount);
  }

  const [prefMap, profile] = await Promise.all([
    getReminderPreferenceMap([studentId]),
    prisma.profile.findUnique({
      where: { userId: studentId },
      select: { timezone: true },
    }),
  ]);
  const pref: ReminderPreference = prefMap.get(studentId) ?? {
    ...DEFAULT_REMINDER_PREFERENCE,
  };
  const localHour = localHourInTimeZone(now, pref.timezone ?? profile?.timezone ?? null);
  const decision = shouldSendNow(pref, localHour);
  if (!decision.send) {
    log.info("assignment reminder suppressed by preference", {
      studentId,
      reason: decision.reason,
      localHour,
    });
    return {
      studentId,
      dueCount,
      sent: 0,
      skipped: false,
      suppressed: true,
      reason: decision.reason,
    };
  }

  const payload: PushPayload = {
    title: reminderAssignment.title,
    body: reminderAssignment.body(dueCount),
    url: reminderAssignment.url,
    icon: reminderAssignment.icon,
  };
  const sent = await sendToSubs(subs, JSON.stringify(payload));
  return { studentId, dueCount, sent, skipped: false, suppressed: false };
}

/**
 * Sends assignment due/overdue reminders to all eligible students in batch.
 * Returns all-zeros when VAPID is unconfigured.
 */
export async function sendDueAssignmentReminders(): Promise<AssignmentReminderResult> {
  if (!isPushConfigured()) {
    log.info("sendDueAssignmentReminders: VAPID unconfigured — no-op");
    return emptyAssignmentReminderResult();
  }

  const now = new Date();

  // ONE query: fetch all due/overdue assignments with their classroom members
  // and completed student IDs.
  const dueAssignments = await prisma.assignment.findMany({
    where: { dueDate: { not: null, lte: now } },
    select: {
      id: true,
      classroom: {
        select: {
          members: {
            where: { role: "Student" },
            select: { userId: true },
          },
        },
      },
      completions: {
        where: { status: AssignmentStatus.COMPLETED },
        select: { studentId: true },
      },
      targets: { select: { studentId: true } },
    },
  });

  // Reduce in-memory: Map<studentId, dueCount> — avoid N+1.
  const dueCountMap = new Map<string, number>();
  for (const assignment of dueAssignments) {
    const completedStudents = new Set(assignment.completions.map((c) => c.studentId));
    const audience = effectiveStudentIds(
      assignment.classroom.members.map((m) => m.userId),
      assignment.targets.map((t) => t.studentId),
    );
    for (const studentId of audience) {
      if (!completedStudents.has(studentId)) {
        dueCountMap.set(studentId, (dueCountMap.get(studentId) ?? 0) + 1);
      }
    }
  }

  if (dueCountMap.size === 0) {
    return emptyAssignmentReminderResult();
  }

  const dueStudentIds = [...dueCountMap.keys()];

  // Batch-load all subscriptions for due students.
  const allSubs = await prisma.pushSubscription.findMany({
    where: { userId: { in: dueStudentIds } },
    select: {
      id: true,
      userId: true,
      endpoint: true,
      p256dh: true,
      auth: true,
      failureCount: true,
    },
  });

  const subsByStudent = groupSubscriptionsByUser(allSubs);
  const subscribedStudentIds = [...subsByStudent.keys()];

  // Batch-load prefs + profile timezones.
  const [prefMap, profiles] = await Promise.all([
    getReminderPreferenceMap(subscribedStudentIds),
    prisma.profile.findMany({
      where: { userId: { in: subscribedStudentIds } },
      select: { userId: true, timezone: true },
    }),
  ]);
  const tzByStudent = new Map(profiles.map((p) => [p.userId, p.timezone]));

  const result: AssignmentReminderResult = {
    studentsWithDue: dueCountMap.size,
    sent: 0,
    skipped: dueCountMap.size - subscribedStudentIds.length,
    suppressed: 0,
  };

  for (const studentId of subscribedStudentIds) {
    const pref: ReminderPreference = prefMap.get(studentId) ?? {
      ...DEFAULT_REMINDER_PREFERENCE,
    };
    const tz = pref.timezone ?? tzByStudent.get(studentId) ?? null;
    const localHour = localHourInTimeZone(now, tz);
    const decision = shouldSendNow(pref, localHour);
    if (!decision.send) {
      result.suppressed++;
      log.info("assignment reminder suppressed by preference", {
        studentId,
        reason: decision.reason,
        localHour,
      });
      continue;
    }

    const count = dueCountMap.get(studentId) ?? 0;
    const payload: PushPayload = {
      title: reminderAssignment.title,
      body: reminderAssignment.body(count),
      url: reminderAssignment.url,
      icon: reminderAssignment.icon,
    };
    const delivered = await sendToSubs(subsByStudent.get(studentId) ?? [], JSON.stringify(payload));
    if (delivered > 0) result.sent++;
  }

  log.info("sendDueAssignmentReminders complete", {
    studentsWithDue: result.studentsWithDue,
    sent: result.sent,
    skipped: result.skipped,
    suppressed: result.suppressed,
  });
  return result;
}

// ---------------------------------------------------------------------------
// remindAssignmentStudents — GAP-5 teacher nudge orchestration
// ---------------------------------------------------------------------------

export type RemindAssignmentResult = {
  total: number;
  notified: number;
  skipped: number;
  suppressed: number;
};

/**
 * Nudges every enrolled student who has NOT completed the given assignment,
 * reusing sendAssignmentReminderToStudent (which honours push opt-in + quiet
 * hours). Returns null when the assignment does not exist. Metadata-only result
 * — never returns student ids or content.
 */
export async function remindAssignmentStudents(assignmentId: string): Promise<RemindAssignmentResult | null> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      classroom: { select: { members: { where: { role: "Student" }, select: { userId: true } } } },
      completions: { where: { status: AssignmentStatus.COMPLETED }, select: { studentId: true } },
      targets: { select: { studentId: true } },
    },
  });
  if (!assignment) return null;
  const completed = new Set(assignment.completions.map((c) => c.studentId));
  const audience = effectiveStudentIds(
    assignment.classroom.members.map((m) => m.userId),
    assignment.targets.map((t) => t.studentId),
  );
  const nudges = audience.filter((id) => !completed.has(id));
  const result: RemindAssignmentResult = { total: nudges.length, notified: 0, skipped: 0, suppressed: 0 };
  for (const studentId of nudges) {
    const r = await sendAssignmentReminderToStudent(studentId);
    if (r.sent > 0) result.notified++;
    else if (r.suppressed) result.suppressed++;
    else result.skipped++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyAssignmentReminderResult(): AssignmentReminderResult {
  return { studentsWithDue: 0, sent: 0, skipped: 0, suppressed: 0 };
}

function skippedStudentReminder(
  studentId: string,
  reason: AssignmentReminderUserResult["reason"],
  dueCount = 0,
): AssignmentReminderUserResult {
  return { studentId, dueCount, sent: 0, skipped: true, suppressed: false, reason };
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
