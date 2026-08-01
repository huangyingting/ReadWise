/**
 * Tests for push reminder scheduler: sendDueReminders
 * and reminder preference suppression (RW-045).
 *
 * Mocks: web-push, @/lib/prisma.
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

type SavedWordGroup = { userId: string; _count: { id: number } };

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

let sendCalls: { endpoint: string; payload: string }[] = [];
let sendShouldFail: number | false = false;

let savedWordGroups: SavedWordGroup[] = [];
let savedWordCounts: Record<string, number> = {};

let mockReminderPrefs: ReminderPreference[] = [];
let mockProfiles: { userId: string; timezone: string | null }[] = [];

let deletedSubIds: string[][] = [];
let updatedManyCalls: { ids?: string[]; data: Record<string, unknown> }[] = [];

function dueWords(userId: string, count: number): SavedWordGroup {
  return { userId, _count: { id: count } };
}

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

function sentPayloadForUser(userId: string): ReminderPayload {
  const call = sendCalls.find((c) => c.endpoint.endsWith(`/${userId}`));
  assert.ok(call, `expected push call for ${userId}`);
  return JSON.parse(call.payload) as ReminderPayload;
}

test("notification tags never echo an untrusted idempotency key", async () => {
  const { reminderNotificationTag } = await import("@/lib/push/notification-idempotency");
  const privateProse = "ordinary private article sentence";
  const tag = reminderNotificationTag(
    "srs",
    new Date("2026-07-31T10:45:00.000Z"),
    privateProse,
  );

  assert.equal(tag, "readwise:srs:2026-07-31T10");
  assert.doesNotMatch(tag, /ordinary private article sentence/);
});

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
            where?: { userId?: string | { in?: string[] }; endpoint?: string };
            distinct?: string[];
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
            if (args.distinct?.includes("userId")) {
              const seen = new Set<string>();
              rows = rows.filter((s) => {
                if (seen.has(s.userId)) return false;
                seen.add(s.userId);
                return true;
              });
            }
            return rows;
          },
          deleteMany: async (args: {
            where?: { id?: { in?: string[] }; endpoint?: string; userId?: string };
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
          upsert: async (args: {
            create: { id?: string; userId: string; endpoint: string; p256dh: string; auth: string };
          }) => {
            mockSubs.push({ id: args.create.id ?? "new", ...args.create });
            return args.create;
          },
        },
        savedWord: {
          groupBy: async () => savedWordGroups,
          count: async (args: { where?: { userId?: string } }) => {
            const userId = args.where?.userId;
            if (!userId) return 0;
            if (Object.prototype.hasOwnProperty.call(savedWordCounts, userId)) {
              return savedWordCounts[userId];
            }
            return savedWordGroups.find((row) => row.userId === userId)?._count.id ?? 0;
          },
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
});

beforeEach(() => {
  mockSubs = [];
  sendCalls = [];
  sendShouldFail = false;
  savedWordGroups = [];
  savedWordCounts = {};
  mockReminderPrefs = [];
  mockProfiles = [];
  deletedSubIds = [];
  updatedManyCalls = [];

  process.env.VAPID_PUBLIC_KEY = "BFakePubKey1234567890abcdef";
  process.env.VAPID_PRIVATE_KEY = "FakePrivKey1234567890abcdef";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  delete process.env.FEATURE_TODAY_SESSION_ENABLED;
});

describe("sendPushReminderForUser", () => {
  test("returns skipped without sending when VAPID is unconfigured", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    savedWordCounts.u1 = 4;
    mockSubs = [subscription("s1", "u1")];

    const { sendPushReminderForUser } = await import("@/lib/push/scheduler");
    const result = await sendPushReminderForUser("u1");

    assert.deepEqual(result, {
      userId: "u1",
      dueCount: 0,
      sent: 0,
      skipped: true,
      suppressed: false,
      reason: "unconfigured",
    });
    assert.equal(sendCalls.length, 0);
  });

  test("returns skipped when the user has no due cards", async () => {
    savedWordCounts.u1 = 0;
    mockSubs = [subscription("s1", "u1")];

    const { sendPushReminderForUser } = await import("@/lib/push/scheduler");
    assert.deepEqual(await sendPushReminderForUser("u1"), {
      userId: "u1",
      dueCount: 0,
      sent: 0,
      skipped: true,
      suppressed: false,
      reason: "no_due_cards",
    });
    assert.equal(sendCalls.length, 0);
  });

  test("returns skipped when a user with due cards has no subscription", async () => {
    savedWordCounts.u1 = 2;
    mockSubs = [];

    const { sendPushReminderForUser } = await import("@/lib/push/scheduler");
    assert.deepEqual(await sendPushReminderForUser("u1"), {
      userId: "u1",
      dueCount: 2,
      sent: 0,
      skipped: true,
      suppressed: false,
      reason: "no_subscription",
    });
    assert.equal(sendCalls.length, 0);
  });

  test("returns a suppressed result when the user's reminder preference is disabled", async () => {
    savedWordCounts.u1 = 2;
    mockSubs = [subscription("s1", "u1")];
    mockReminderPrefs = [reminderPreference("u1", { enabled: false })];

    const { sendPushReminderForUser } = await import("@/lib/push/scheduler");
    assert.deepEqual(await sendPushReminderForUser("u1"), {
      userId: "u1",
      dueCount: 2,
      sent: 0,
      skipped: false,
      suppressed: true,
      reason: "disabled",
    });
    assert.equal(sendCalls.length, 0);
  });

  test("sends a due reminder for one user using existing reminder copy", async () => {
    savedWordCounts.u1 = 3;
    mockSubs = [subscription("s1", "u1"), subscription("s2", "other")];

    const { sendPushReminderForUser } = await import("@/lib/push/scheduler");
    const result = await sendPushReminderForUser("u1");

    assert.equal(result.userId, "u1");
    assert.equal(result.dueCount, 3);
    assert.equal(result.sent, 1);
    assert.equal(result.skipped, false);
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].endpoint, "https://push.example.com/u1");
    assert.ok(sentPayload().body.includes("3 words"));
  });

  test("durable retries reuse the supplied idempotency key as a notification tag", async () => {
    savedWordCounts.u1 = 1;
    mockSubs = [subscription("s1", "u1")];
    const { sendPushReminderForUser } = await import("@/lib/push/scheduler");

    await sendPushReminderForUser("u1", { idempotencyKey: "push-job-123" });

    assert.equal(sentPayload().tag, "readwise:srs:push-job-123");
  });

  test("handles dead subscriptions gracefully", async () => {
    savedWordCounts.u1 = 1;
    mockSubs = [subscription("dead", "u1")];
    sendShouldFail = 410;

    const { sendPushReminderForUser } = await import("@/lib/push/scheduler");
    const result = await sendPushReminderForUser("u1");

    assert.equal(result.userId, "u1");
    assert.equal(result.dueCount, 1);
    assert.equal(result.sent, 0);
    assert.deepEqual(deletedSubIds, [["dead"]]);
  });
});

// ---------------------------------------------------------------------------
// sendDueReminders
// ---------------------------------------------------------------------------

describe("sendDueReminders", () => {
  test("returns zeros when VAPID unconfigured", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    const result = await sendDueReminders();
    assert.equal(result.usersWithDue, 0);
    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 0);
  });

  test("returns zeros when no users have due cards", async () => {
    savedWordGroups = [];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    const result = await sendDueReminders();
    assert.equal(result.usersWithDue, 0);
    assert.equal(result.sent, 0);
  });

  test("skips users without subscriptions", async () => {
    savedWordGroups = [dueWords("user-no-sub", 5)];
    mockSubs = [];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    const result = await sendDueReminders();
    assert.equal(result.usersWithDue, 1);
    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 1);
  });

  test("sends to subscribed users with due cards", async () => {
    savedWordGroups = [
      dueWords("u1", 3),
      dueWords("u2", 1),
    ];
    mockSubs = [
      subscription("s1", "u1"),
      subscription("s2", "u2"),
    ];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    const result = await sendDueReminders();
    assert.equal(result.usersWithDue, 2);
    assert.equal(result.sent, 2);
    assert.equal(result.skipped, 0);
    const payloadU1 = sentPayloadForUser("u1");
    assert.ok(payloadU1.body.includes("3 words"), `Expected '3 words' in '${payloadU1.body}'`);
    const payloadU2 = sentPayloadForUser("u2");
    assert.ok(payloadU2.body.includes("1 word"), `Expected '1 word' in '${payloadU2.body}'`);
  });

  test("payload deep-links to /today when Today Session is enabled (default)", async () => {
    savedWordGroups = [dueWords("u1", 2)];
    mockSubs = [subscription("s1", "u1")];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    await sendDueReminders();
    const payload = sentPayload();
    assert.equal(payload.url, "/today");
  });

  test("payload deep-links to /today when flag explicitly enabled", async () => {
    process.env.FEATURE_TODAY_SESSION_ENABLED = "true";
    savedWordGroups = [dueWords("u1", 2)];
    mockSubs = [subscription("s1", "u1")];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    await sendDueReminders();
    const payload = sentPayload();
    assert.equal(payload.url, "/today");
  });

  test("payload keeps /study url when Today Session is disabled", async () => {
    process.env.FEATURE_TODAY_SESSION_ENABLED = "false";
    savedWordGroups = [dueWords("u1", 2)];
    mockSubs = [subscription("s1", "u1")];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    await sendDueReminders();
    const payload = sentPayload();
    assert.equal(payload.url, "/study");
  });

  test("payload copy stays content-safe (no PII / article / word content)", async () => {
    savedWordGroups = [dueWords("u1", 3)];
    mockSubs = [subscription("s1", "u1")];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    await sendDueReminders();
    const payload = sentPayload();
    // Only generic copy + a numeric count — never any specific content.
    const keys = Object.keys(payload).sort();
    assert.deepEqual(keys, ["body", "icon", "tag", "title", "url"]);
    assert.match(payload.tag, /^readwise:srs:/);
    assert.match(payload.body, /\b3\b/);
    assert.doesNotMatch(payload.body, /title|note|definition|example|sentence/i);
  });
});

// ---------------------------------------------------------------------------
// Reminder preferences in sendDueReminders (RW-045)
// ---------------------------------------------------------------------------

describe("reminder preferences in sendDueReminders (RW-045)", () => {
  test("suppresses users who disabled reminders", async () => {
    savedWordGroups = [dueWords("u1", 4)];
    mockSubs = [subscription("s1", "u1")];
    mockReminderPrefs = [reminderPreference("u1", { enabled: false })];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    const result = await sendDueReminders();
    assert.equal(result.usersWithDue, 1);
    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 0, "the user HAS a subscription, so not 'skipped'");
    assert.equal(result.suppressed, 1, "disabled preference should suppress the send");
    assert.equal(sendCalls.length, 0);
  });

  test("still sends to users with default (enabled) preferences", async () => {
    savedWordGroups = [dueWords("u1", 2)];
    mockSubs = [subscription("s1", "u1")];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    const result = await sendDueReminders();
    assert.equal(result.sent, 1);
    assert.equal(result.suppressed, 0);
  });
});
