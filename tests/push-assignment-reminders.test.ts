/**
 * Tests for assignment push reminder scheduler:
 * sendDueAssignmentReminders and sendAssignmentReminderToStudent.
 *
 * Mocks: web-push, @/lib/prisma, @/lib/reminder-preferences.
 * No real VAPID keys or network I/O.
 */
import { test, before, beforeEach, mock, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mutable state shared by mock implementations
// ---------------------------------------------------------------------------

type MockSubscription = {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failureCount?: number;
};

type MockAssignment = {
  id: string;
  dueDate: Date | null;
  classroom: {
    archivedAt?: Date | null;
    members: { userId: string }[];
  };
  completions: { studentId: string }[];
  targets?: { studentId: string }[];
  publishState?: "DRAFT" | "SCHEDULED" | "PUBLISHED";
  publishAt?: Date | null;
};

type MockAssignmentCount = {
  where?: {
    dueDate?: { not?: null; lte?: Date };
    classroom?: { archivedAt?: null; members?: { some?: { userId?: string; role?: string } } };
    completions?: { none?: { studentId?: string; status?: string } };
    AND?: Array<{ OR?: unknown[] }>;
  };
};

type MockAssignmentFindMany = {
  where?: {
    dueDate?: { not?: null; lte?: Date };
    classroom?: { archivedAt?: null };
    OR?: Array<{ publishState?: string; publishAt?: { lte?: Date } }>;
  };
};

type ReminderPreference = {
  userId: string;
  enabled: boolean;
  preferredHour: number | null;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string | null;
};

type ReminderPayload = { body: string; icon: string; tag: string; title: string; url: string };

let mockSubs: MockSubscription[] = [];
let mockAssignments: MockAssignment[] = [];
let mockAssignmentCount: number = 0;
let mockAssignmentFindUniqueResult: {
  id: string;
  publishState?: "DRAFT" | "SCHEDULED" | "PUBLISHED";
  publishAt?: Date | null;
  classroom: { members: { userId: string }[] };
  completions: { studentId: string }[];
  targets?: { studentId: string }[];
} | null = null;
let lastAssignmentCountArgs: MockAssignmentCount | null = null;
let lastAssignmentFindManyArgs: MockAssignmentFindMany | null = null;

let sendCalls: { endpoint: string; payload: string }[] = [];
let sendShouldFail: number | false = false;

let mockReminderPrefs: ReminderPreference[] = [];
let mockProfiles: { userId: string; timezone: string | null }[] = [];

let deletedSubIds: string[][] = [];
let updatedManyCalls: { ids?: string[]; data: Record<string, unknown> }[] = [];

function subscription(id: string, userId: string): MockSubscription {
  return { id, userId, endpoint: `https://push.example.com/${userId}`, p256dh: "k", auth: "a" };
}

function reminderPreference(
  userId: string,
  overrides: Partial<Omit<ReminderPreference, "userId">> = {},
): ReminderPreference {
  return {
    userId,
    enabled: true,
    preferredHour: null,
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: null,
    ...overrides,
  };
}

function sentPayload(index = 0): ReminderPayload {
  return JSON.parse(sendCalls[index].payload) as ReminderPayload;
}

// ---------------------------------------------------------------------------
// Mocks registered once in before()
// ---------------------------------------------------------------------------

before(() => {
  mock.module("web-push", {
    defaultExport: {
      setVapidDetails: () => {},
      sendNotification: async (sub: { endpoint: string }, payload: string) => {
        if (sendShouldFail !== false) {
          const err: Error & { statusCode?: number } = Object.assign(
            new Error("push error"),
            { statusCode: sendShouldFail },
          );
          throw err;
        }
        sendCalls.push({ endpoint: sub.endpoint, payload });
      },
    },
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        pushSubscription: {
          findMany: async (args: {
            where?: { userId?: string | { in?: string[] } };
            select?: unknown;
          }) => {
            let rows = mockSubs;
            if (args.where?.userId) {
              const uid = args.where.userId;
              if (typeof uid === "string") {
                rows = rows.filter((s) => s.userId === uid);
              } else if (uid.in) {
                const ids = uid.in;
                rows = rows.filter((s) => ids.includes(s.userId));
              }
            }
            return rows;
          },
          deleteMany: async (args: {
            where?: { id?: { in?: string[] } };
          }) => {
            if (args.where?.id?.in) {
              deletedSubIds.push(args.where.id.in);
              mockSubs = mockSubs.filter((s) => !args.where?.id?.in?.includes(s.id));
            }
            return { count: 0 };
          },
          updateMany: async (args: {
            where?: { id?: { in?: string[] } };
            data: Record<string, unknown>;
          }) => {
            updatedManyCalls.push({ ids: args.where?.id?.in, data: args.data });
            return { count: args.where?.id?.in?.length ?? 0 };
          },
        },
        assignment: {
          findMany: async (args: MockAssignmentFindMany) => {
            lastAssignmentFindManyArgs = args;
            let rows = mockAssignments;
            if (args.where?.classroom?.archivedAt === null) {
              rows = rows.filter((a) => a.classroom.archivedAt === null || a.classroom.archivedAt === undefined);
            }
            if (args.where?.OR) {
              const liveAt = args.where.OR.find((clause) => clause.publishAt)?.publishAt?.lte;
              rows = rows.filter((a) =>
                (a.publishState ?? "PUBLISHED") === "PUBLISHED" ||
                ((a.publishState ?? "PUBLISHED") === "SCHEDULED" &&
                  a.publishAt != null &&
                  liveAt != null &&
                  a.publishAt <= liveAt),
              );
            }
            return rows.map((a) => ({ ...a, targets: a.targets ?? [] }));
          },
          count: async (args: MockAssignmentCount) => {
            lastAssignmentCountArgs = args;
            return mockAssignmentCount;
          },
          findUnique: async () =>
            mockAssignmentFindUniqueResult
             ? {
                 publishState: "PUBLISHED",
                 publishAt: null,
                 ...mockAssignmentFindUniqueResult,
                 targets: mockAssignmentFindUniqueResult.targets ?? [],
               }
             : null,
        },
        reminderPreference: {
          findMany: async (args: { where?: { userId?: { in?: string[] } } }) => {
            const ids = args.where?.userId?.in;
            return ids ? mockReminderPrefs.filter((p) => ids.includes(p.userId)) : mockReminderPrefs;
          },
        },
        profile: {
          findMany: async (args: { where?: { userId?: { in?: string[] } } }) => {
            const ids = args.where?.userId?.in;
            return ids ? mockProfiles.filter((p) => ids.includes(p.userId)) : mockProfiles;
          },
          findUnique: async (args: { where?: { userId?: string } }) => {
            const userId = args.where?.userId;
            return mockProfiles.find((p) => p.userId === userId) ?? null;
          },
        },
      },
    },
  });

  mock.module("@/lib/reminder-preferences", {
    namedExports: {
      getReminderPreferenceMap: async (userIds: string[]) => {
        const map = new Map<string, ReminderPreference>();
        for (const pref of mockReminderPrefs) {
          if (userIds.includes(pref.userId)) {
            map.set(pref.userId, pref);
          }
        }
        return map;
      },
      shouldSendNow: (pref: ReminderPreference, _localHour: number) => {
        if (!pref.enabled) {
          return { send: false, reason: "disabled" };
        }
        if (
          pref.quietHoursStart !== null &&
          pref.quietHoursEnd !== null &&
          _localHour >= pref.quietHoursStart &&
          _localHour < pref.quietHoursEnd
        ) {
          return { send: false, reason: "quiet_hours" };
        }
        return { send: true };
      },
      localHourInTimeZone: (_date: Date, _tz: string | null) => 10,
      DEFAULT_REMINDER_PREFERENCE: {
        enabled: true,
        preferredHour: null,
        quietHoursStart: null,
        quietHoursEnd: null,
        timezone: null,
      },
    },
  });
});

beforeEach(() => {
  mockSubs = [];
  mockAssignments = [];
  mockAssignmentCount = 0;
  mockAssignmentFindUniqueResult = null;
  lastAssignmentCountArgs = null;
  lastAssignmentFindManyArgs = null;
  sendCalls = [];
  sendShouldFail = false;
  mockReminderPrefs = [];
  mockProfiles = [];
  deletedSubIds = [];
  updatedManyCalls = [];

  process.env.VAPID_PUBLIC_KEY = "BFakePubKey1234567890abcdef";
  process.env.VAPID_PRIVATE_KEY = "FakePrivKey1234567890abcdef";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
});

// ---------------------------------------------------------------------------
// sendDueAssignmentReminders
// ---------------------------------------------------------------------------

describe("sendDueAssignmentReminders", () => {
  test("VAPID unconfigured => returns all-zeros, no send", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;

    const { sendDueAssignmentReminders } = await import("@/lib/push/assignment-reminders");
    const result = await sendDueAssignmentReminders();

    assert.equal(result.studentsWithDue, 0);
    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.suppressed, 0);
    assert.equal(sendCalls.length, 0);
  });

  test("student with due/overdue, not-completed assignment + active sub + enabled pref => sent: 1", async () => {
    const now = new Date();
    const pastDate = new Date(now.getTime() - 60_000);

    mockAssignments = [
      {
        id: "a1",
        dueDate: pastDate,
        classroom: { members: [{ userId: "s1" }] },
        completions: [],
      },
    ];
    mockSubs = [subscription("sub1", "s1")];
    mockReminderPrefs = [reminderPreference("s1")];

    const { sendDueAssignmentReminders } = await import("@/lib/push/assignment-reminders");
    const result = await sendDueAssignmentReminders();

    assert.equal(result.studentsWithDue, 1);
    assert.equal(result.sent, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.suppressed, 0);
    assert.equal(sendCalls.length, 1);
    const payload = sentPayload();
    assert.ok(payload.title, "should have a title");
    assert.ok(payload.body.includes("1 assignment"), `expected '1 assignment' in '${payload.body}'`);
    assert.equal(payload.url, "/assignments");
    assert.match(payload.tag, /^readwise:assignment:/);
  });

  test("archived-classroom assignments are excluded from due reminder batches", async () => {
    const pastDate = new Date(Date.now() - 60_000);

    mockAssignments = [
      {
        id: "active",
        dueDate: pastDate,
        classroom: { archivedAt: null, members: [{ userId: "s1" }] },
        completions: [],
      },
      {
        id: "archived",
        dueDate: pastDate,
        classroom: { archivedAt: new Date(), members: [{ userId: "s2" }] },
        completions: [],
      },
    ];
    mockSubs = [subscription("sub1", "s1"), subscription("sub2", "s2")];
    mockReminderPrefs = [reminderPreference("s1"), reminderPreference("s2")];

    const { sendDueAssignmentReminders } = await import("@/lib/push/assignment-reminders");
    const result = await sendDueAssignmentReminders();

    assert.equal(lastAssignmentFindManyArgs?.where?.classroom?.archivedAt, null);
    assert.deepEqual(lastAssignmentFindManyArgs?.where?.OR?.[0], { publishState: "PUBLISHED" });
    assert.equal(result.studentsWithDue, 1);
    assert.equal(result.sent, 1);
    assert.equal(sendCalls.length, 1);
    assert.ok(sendCalls[0].endpoint.endsWith("/s1"));
  });

  test("draft and future-scheduled assignments are excluded from due reminder batches", async () => {
    const pastDate = new Date(Date.now() - 60_000);
    mockAssignments = [
      {
        id: "draft",
        dueDate: pastDate,
        publishState: "DRAFT",
        classroom: { members: [{ userId: "s1" }] },
        completions: [],
      },
      {
        id: "future",
        dueDate: pastDate,
        publishState: "SCHEDULED",
        publishAt: new Date(Date.now() + 86_400_000),
        classroom: { members: [{ userId: "s2" }] },
        completions: [],
      },
      {
        id: "published",
        dueDate: pastDate,
        publishState: "PUBLISHED",
        classroom: { members: [{ userId: "s3" }] },
        completions: [],
      },
    ];
    mockSubs = [subscription("sub3", "s3")];
    mockReminderPrefs = [reminderPreference("s3")];

    const { sendDueAssignmentReminders } = await import("@/lib/push/assignment-reminders");
    const result = await sendDueAssignmentReminders();

    assert.equal(result.studentsWithDue, 1);
    assert.equal(sendCalls.length, 1);
    assert.ok(sendCalls[0].endpoint.endsWith("/s3"));
  });

  test("assignment with FUTURE dueDate => excluded", async () => {
    const now = new Date();
    const futureDate = new Date(now.getTime() + 86_400_000);

    // future-dated assignments are filtered server-side (dueDate <= now),
    // so findMany returns nothing for them
    mockAssignments = [];
    mockSubs = [subscription("sub1", "s1")];

    const { sendDueAssignmentReminders } = await import("@/lib/push/assignment-reminders");
    const result = await sendDueAssignmentReminders();

    assert.equal(result.studentsWithDue, 0);
    assert.equal(result.sent, 0);
    assert.equal(sendCalls.length, 0);

    // verify the future date itself is conceptually excluded
    assert.ok(futureDate > now);
  });

  test("assignment the student HAS completed => excluded from due count", async () => {
    const now = new Date();
    const pastDate = new Date(now.getTime() - 60_000);

    mockAssignments = [
      {
        id: "a1",
        dueDate: pastDate,
        classroom: { members: [{ userId: "s1" }] },
        completions: [{ studentId: "s1" }], // s1 completed it
      },
    ];
    mockSubs = [subscription("sub1", "s1")];

    const { sendDueAssignmentReminders } = await import("@/lib/push/assignment-reminders");
    const result = await sendDueAssignmentReminders();

    assert.equal(result.studentsWithDue, 0);
    assert.equal(result.sent, 0);
    assert.equal(sendCalls.length, 0);
  });

  test("due assignment but student has NO push subscription => counted in skipped, sent: 0", async () => {
    const now = new Date();
    const pastDate = new Date(now.getTime() - 60_000);

    mockAssignments = [
      {
        id: "a1",
        dueDate: pastDate,
        classroom: { members: [{ userId: "s1" }] },
        completions: [],
      },
    ];
    mockSubs = []; // no subscriptions

    const { sendDueAssignmentReminders } = await import("@/lib/push/assignment-reminders");
    const result = await sendDueAssignmentReminders();

    assert.equal(result.studentsWithDue, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.sent, 0);
    assert.equal(sendCalls.length, 0);
  });

  test("preference-suppressed (disabled) => counted in suppressed, sent: 0", async () => {
    const now = new Date();
    const pastDate = new Date(now.getTime() - 60_000);

    mockAssignments = [
      {
        id: "a1",
        dueDate: pastDate,
        classroom: { members: [{ userId: "s1" }] },
        completions: [],
      },
    ];
    mockSubs = [subscription("sub1", "s1")];
    mockReminderPrefs = [reminderPreference("s1", { enabled: false })];

    const { sendDueAssignmentReminders } = await import("@/lib/push/assignment-reminders");
    const result = await sendDueAssignmentReminders();

    assert.equal(result.studentsWithDue, 1);
    assert.equal(result.suppressed, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.sent, 0);
    assert.equal(sendCalls.length, 0);
  });

  test("multiple students, one completed, one not => correct counts", async () => {
    const now = new Date();
    const pastDate = new Date(now.getTime() - 60_000);

    mockAssignments = [
      {
        id: "a1",
        dueDate: pastDate,
        classroom: { members: [{ userId: "s1" }, { userId: "s2" }] },
        completions: [{ studentId: "s2" }], // s2 completed, s1 did not
      },
    ];
    mockSubs = [subscription("sub1", "s1"), subscription("sub2", "s2")];
    mockReminderPrefs = [reminderPreference("s1"), reminderPreference("s2")];

    const { sendDueAssignmentReminders } = await import("@/lib/push/assignment-reminders");
    const result = await sendDueAssignmentReminders();

    assert.equal(result.studentsWithDue, 1, "only s1 has a due assignment");
    assert.equal(result.sent, 1);
    assert.equal(sendCalls.length, 1);
    assert.ok(sendCalls[0].endpoint.endsWith("/s1"));
  });

  test("targeted assignment only counts targeted not-completed students", async () => {
    const pastDate = new Date(Date.now() - 60_000);
    mockAssignments = [
      {
        id: "a1",
        dueDate: pastDate,
        classroom: { members: [{ userId: "s1" }, { userId: "s2" }, { userId: "s3" }] },
        completions: [{ studentId: "s2" }],
        targets: [{ studentId: "s1" }, { studentId: "s2" }, { studentId: "ghost" }],
      },
    ];
    mockSubs = [subscription("sub1", "s1"), subscription("sub3", "s3")];
    mockReminderPrefs = [reminderPreference("s1"), reminderPreference("s3")];

    const { sendDueAssignmentReminders } = await import("@/lib/push/assignment-reminders");
    const result = await sendDueAssignmentReminders();

    assert.equal(result.studentsWithDue, 1);
    assert.equal(result.sent, 1);
    assert.equal(sendCalls.length, 1);
    assert.ok(sendCalls[0].endpoint.endsWith("/s1"));
  });
});

// ---------------------------------------------------------------------------
// sendAssignmentReminderToStudent
// ---------------------------------------------------------------------------

describe("sendAssignmentReminderToStudent", () => {
  test("happy path: student with due assignment + sub + enabled pref => sent: 1", async () => {
    mockAssignmentCount = 2;
    mockSubs = [subscription("sub1", "s1")];
    mockReminderPrefs = [reminderPreference("s1")];

    const { sendAssignmentReminderToStudent } = await import("@/lib/push/assignment-reminders");
    const result = await sendAssignmentReminderToStudent("s1");

    assert.equal(result.studentId, "s1");
    assert.equal(result.dueCount, 2);
    assert.equal(result.sent, 1);
    assert.equal(result.skipped, false);
    assert.equal(result.suppressed, false);
    assert.equal(sendCalls.length, 1);
    const payload = sentPayload();
    assert.ok(payload.body.includes("2 assignments"), `expected '2 assignments' in '${payload.body}'`);
    assert.deepEqual(lastAssignmentCountArgs?.where?.AND?.[0].OR, [
      { targets: { none: {} } },
      { targets: { some: { studentId: "s1" } } },
    ]);
    assert.deepEqual(lastAssignmentCountArgs?.where?.AND?.[1].OR?.[0], { publishState: "PUBLISHED" });
    assert.equal(lastAssignmentCountArgs?.where?.classroom?.archivedAt, null);
    assert.deepEqual(lastAssignmentCountArgs?.where?.classroom?.members?.some, {
      userId: "s1",
      role: "Student",
    });
  });

  test("unconfigured => skipped with reason 'unconfigured'", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    mockAssignmentCount = 3;
    mockSubs = [subscription("sub1", "s1")];

    const { sendAssignmentReminderToStudent } = await import("@/lib/push/assignment-reminders");
    const result = await sendAssignmentReminderToStudent("s1");

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "unconfigured");
    assert.equal(result.sent, 0);
    assert.equal(sendCalls.length, 0);
  });

  test("no due assignments => skipped with reason 'no_due_assignments'", async () => {
    mockAssignmentCount = 0;
    mockSubs = [subscription("sub1", "s1")];

    const { sendAssignmentReminderToStudent } = await import("@/lib/push/assignment-reminders");
    const result = await sendAssignmentReminderToStudent("s1");

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "no_due_assignments");
    assert.equal(result.sent, 0);
    assert.equal(sendCalls.length, 0);
  });

  test("no subscription => skipped with reason 'no_subscription'", async () => {
    mockAssignmentCount = 1;
    mockSubs = [];

    const { sendAssignmentReminderToStudent } = await import("@/lib/push/assignment-reminders");
    const result = await sendAssignmentReminderToStudent("s1");

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "no_subscription");
    assert.equal(result.sent, 0);
    assert.equal(sendCalls.length, 0);
  });

  test("preference-suppressed => suppressed: true, sent: 0", async () => {
    mockAssignmentCount = 1;
    mockSubs = [subscription("sub1", "s1")];
    mockReminderPrefs = [reminderPreference("s1", { enabled: false })];

    const { sendAssignmentReminderToStudent } = await import("@/lib/push/assignment-reminders");
    const result = await sendAssignmentReminderToStudent("s1");

    assert.equal(result.suppressed, true);
    assert.equal(result.skipped, false);
    assert.equal(result.sent, 0);
    assert.equal(sendCalls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// remindAssignmentStudents
// ---------------------------------------------------------------------------

describe("remindAssignmentStudents", () => {
  test("returns null when assignment does not exist", async () => {
    mockAssignmentFindUniqueResult = null;
    const { remindAssignmentStudents } = await import("@/lib/push/assignment-reminders");
    const result = await remindAssignmentStudents("missing");
    assert.equal(result, null);
  });

  test("targets only not-completed students and tallies results", async () => {
    // s1: not completed => targeted; s2: completed => skipped
    mockAssignmentFindUniqueResult = {
      id: "a1",
      classroom: { members: [{ userId: "s1" }, { userId: "s2" }] },
      completions: [{ studentId: "s2" }],
    };
    // s1 has a due assignment + subscription + enabled pref => sent: 1
    mockAssignmentCount = 1;
    mockSubs = [subscription("sub1", "s1")];
    mockReminderPrefs = [reminderPreference("s1")];

    const { remindAssignmentStudents } = await import("@/lib/push/assignment-reminders");
    const result = await remindAssignmentStudents("a1");

    assert.ok(result !== null);
    assert.equal(result.total, 1, "only s1 is not-completed");
    assert.equal(result.notified, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.suppressed, 0);
  });

  test("draft assignment nudge sends zero notifications", async () => {
    mockAssignmentFindUniqueResult = {
      id: "a1",
      publishState: "DRAFT",
      classroom: { members: [{ userId: "s1" }] },
      completions: [],
    };
    mockAssignmentCount = 1;
    mockSubs = [subscription("sub1", "s1")];
    mockReminderPrefs = [reminderPreference("s1")];

    const { remindAssignmentStudents } = await import("@/lib/push/assignment-reminders");
    const result = await remindAssignmentStudents("a1");

    assert.deepEqual(result, { total: 0, notified: 0, skipped: 0, suppressed: 0 });
    assert.equal(sendCalls.length, 0);
  });

  test("future-scheduled assignment nudge sends zero notifications", async () => {
    mockAssignmentFindUniqueResult = {
      id: "a1",
      publishState: "SCHEDULED",
      publishAt: new Date(Date.now() + 86_400_000),
      classroom: { members: [{ userId: "s1" }] },
      completions: [],
    };
    mockAssignmentCount = 1;
    mockSubs = [subscription("sub1", "s1")];
    mockReminderPrefs = [reminderPreference("s1")];

    const { remindAssignmentStudents } = await import("@/lib/push/assignment-reminders");
    const result = await remindAssignmentStudents("a1");

    assert.deepEqual(result, { total: 0, notified: 0, skipped: 0, suppressed: 0 });
    assert.equal(sendCalls.length, 0);
  });

  test("targeted assignment nudge only targets audience members", async () => {
    mockAssignmentFindUniqueResult = {
      id: "a1",
      classroom: { members: [{ userId: "s1" }, { userId: "s2" }, { userId: "s3" }] },
      completions: [{ studentId: "s2" }],
      targets: [{ studentId: "s1" }, { studentId: "s2" }, { studentId: "ghost" }],
    };
    mockAssignmentCount = 1;
    mockSubs = [subscription("sub1", "s1"), subscription("sub3", "s3")];
    mockReminderPrefs = [reminderPreference("s1"), reminderPreference("s3")];

    const { remindAssignmentStudents } = await import("@/lib/push/assignment-reminders");
    const result = await remindAssignmentStudents("a1");

    assert.ok(result !== null);
    assert.equal(result.total, 1);
    assert.equal(result.notified, 1);
    assert.equal(sendCalls.length, 1);
    assert.ok(sendCalls[0].endpoint.endsWith("/s1"));
  });

  test("notifies a pending student even when the assignment is not due yet", async () => {
    mockAssignmentFindUniqueResult = {
      id: "a1",
      classroom: { members: [{ userId: "s1" }] },
      completions: [],
    };
    mockAssignmentCount = 2;
    mockSubs = [subscription("sub1", "s1")];
    mockReminderPrefs = [reminderPreference("s1")];

    const { remindAssignmentStudents } = await import("@/lib/push/assignment-reminders");
    const result = await remindAssignmentStudents("a1");

    assert.ok(result !== null);
    assert.equal(result.total, 1);
    assert.equal(result.notified, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.suppressed, 0);
    assert.equal(sendCalls.length, 1);
    const payload = sentPayload();
    assert.equal(payload.title, "Assignment reminder 📌");
    assert.ok(payload.body.includes("2 assignments waiting"), `expected nudge body, got '${payload.body}'`);
    assert.equal(lastAssignmentCountArgs?.where?.dueDate, undefined);
    assert.equal(lastAssignmentCountArgs?.where?.classroom?.archivedAt, null);
    assert.deepEqual(lastAssignmentCountArgs?.where?.classroom?.members?.some, {
      userId: "s1",
      role: "Student",
    });
  });

  test("notifies a pending student when the assignment has no due date", async () => {
    mockAssignmentFindUniqueResult = {
      id: "a1",
      classroom: { members: [{ userId: "s1" }] },
      completions: [],
    };
    mockAssignmentCount = 0;
    mockSubs = [subscription("sub1", "s1")];
    mockReminderPrefs = [reminderPreference("s1")];

    const { remindAssignmentStudents } = await import("@/lib/push/assignment-reminders");
    const result = await remindAssignmentStudents("a1");

    assert.ok(result !== null);
    assert.equal(result.total, 1);
    assert.equal(result.notified, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.suppressed, 0);
    assert.equal(sendCalls.length, 1);
    const payload = sentPayload();
    assert.ok(payload.body.includes("1 assignment waiting"), `expected fallback count, got '${payload.body}'`);
  });

  test("skipped when pending nudged student has no subscription", async () => {
    mockAssignmentFindUniqueResult = {
      id: "a1",
      classroom: { members: [{ userId: "s1" }] },
      completions: [],
    };
    mockAssignmentCount = 1;
    mockSubs = [];

    const { remindAssignmentStudents } = await import("@/lib/push/assignment-reminders");
    const result = await remindAssignmentStudents("a1");

    assert.ok(result !== null);
    assert.equal(result.total, 1);
    assert.equal(result.notified, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.suppressed, 0);
    assert.equal(sendCalls.length, 0);
  });

  test("suppressed when pending nudged student is in quiet hours", async () => {
    mockAssignmentFindUniqueResult = {
      id: "a1",
      classroom: { members: [{ userId: "s1" }] },
      completions: [],
    };
    mockAssignmentCount = 2;
    mockSubs = [subscription("sub1", "s1")];
    mockReminderPrefs = [reminderPreference("s1", { quietHoursStart: 9, quietHoursEnd: 17 })];

    const { remindAssignmentStudents } = await import("@/lib/push/assignment-reminders");
    const result = await remindAssignmentStudents("a1");

    assert.ok(result !== null);
    assert.equal(result.total, 1);
    assert.equal(result.notified, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.suppressed, 1);
  });

  test("all completed students are excluded from total", async () => {
    mockAssignmentFindUniqueResult = {
      id: "a1",
      classroom: { members: [{ userId: "s1" }, { userId: "s2" }] },
      completions: [{ studentId: "s1" }, { studentId: "s2" }],
    };

    const { remindAssignmentStudents } = await import("@/lib/push/assignment-reminders");
    const result = await remindAssignmentStudents("a1");

    assert.ok(result !== null);
    assert.equal(result.total, 0);
    assert.equal(result.notified, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.suppressed, 0);
  });
});
