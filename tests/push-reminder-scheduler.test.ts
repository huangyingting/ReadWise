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

let mockSubs: {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failureCount?: number;
}[] = [];

let sendCalls: { endpoint: string; payload: string }[] = [];
let sendShouldFail: number | false = false;

let savedWordGroups: { userId: string; _count: { id: number } }[] = [];

let mockReminderPrefs: {
  userId: string;
  enabled: boolean;
  preferredHour: number | null;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string | null;
}[] = [];
let mockProfiles: { userId: string; timezone: string | null }[] = [];

let deletedSubIds: string[][] = [];
let updatedManyCalls: { ids?: string[]; data: Record<string, unknown> }[] = [];

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
  mockReminderPrefs = [];
  mockProfiles = [];
  deletedSubIds = [];
  updatedManyCalls = [];

  process.env.VAPID_PUBLIC_KEY = "BFakePubKey1234567890abcdef";
  process.env.VAPID_PRIVATE_KEY = "FakePrivKey1234567890abcdef";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  delete process.env.FEATURE_TODAY_SESSION_ENABLED;
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
    savedWordGroups = [{ userId: "user-no-sub", _count: { id: 5 } }];
    mockSubs = [];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    const result = await sendDueReminders();
    assert.equal(result.usersWithDue, 1);
    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 1);
  });

  test("sends to subscribed users with due cards", async () => {
    savedWordGroups = [
      { userId: "u1", _count: { id: 3 } },
      { userId: "u2", _count: { id: 1 } },
    ];
    mockSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/u1", p256dh: "k", auth: "a" },
      { id: "s2", userId: "u2", endpoint: "https://push.example.com/u2", p256dh: "k", auth: "a" },
    ];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    const result = await sendDueReminders();
    assert.equal(result.usersWithDue, 2);
    assert.equal(result.sent, 2);
    assert.equal(result.skipped, 0);
    const payloadU1 = JSON.parse(sendCalls.find((c) => c.endpoint.includes("u1"))!.payload);
    assert.ok(payloadU1.body.includes("3 words"), `Expected '3 words' in '${payloadU1.body}'`);
    const payloadU2 = JSON.parse(sendCalls.find((c) => c.endpoint.includes("u2"))!.payload);
    assert.ok(payloadU2.body.includes("1 word"), `Expected '1 word' in '${payloadU2.body}'`);
  });

  test("payload deep-links to /today when Today Session is enabled (default)", async () => {
    savedWordGroups = [{ userId: "u1", _count: { id: 2 } }];
    mockSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/u1", p256dh: "k", auth: "a" },
    ];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    await sendDueReminders();
    const payload = JSON.parse(sendCalls[0].payload);
    assert.equal(payload.url, "/today");
  });

  test("payload deep-links to /today when flag explicitly enabled", async () => {
    process.env.FEATURE_TODAY_SESSION_ENABLED = "true";
    savedWordGroups = [{ userId: "u1", _count: { id: 2 } }];
    mockSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/u1", p256dh: "k", auth: "a" },
    ];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    await sendDueReminders();
    const payload = JSON.parse(sendCalls[0].payload);
    assert.equal(payload.url, "/today");
  });

  test("payload keeps /study url when Today Session is disabled", async () => {
    process.env.FEATURE_TODAY_SESSION_ENABLED = "false";
    savedWordGroups = [{ userId: "u1", _count: { id: 2 } }];
    mockSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/u1", p256dh: "k", auth: "a" },
    ];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    await sendDueReminders();
    const payload = JSON.parse(sendCalls[0].payload);
    assert.equal(payload.url, "/study");
  });

  test("payload copy stays content-safe (no PII / article / word content)", async () => {
    savedWordGroups = [{ userId: "u1", _count: { id: 3 } }];
    mockSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/u1", p256dh: "k", auth: "a" },
    ];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    await sendDueReminders();
    const payload = JSON.parse(sendCalls[0].payload);
    // Only generic copy + a numeric count — never any specific content.
    const keys = Object.keys(payload).sort();
    assert.deepEqual(keys, ["body", "icon", "title", "url"]);
    assert.match(payload.body, /\b3\b/);
    assert.doesNotMatch(payload.body, /title|note|definition|example|sentence/i);
  });
});

// ---------------------------------------------------------------------------
// Reminder preferences in sendDueReminders (RW-045)
// ---------------------------------------------------------------------------

describe("reminder preferences in sendDueReminders (RW-045)", () => {
  test("suppresses users who disabled reminders", async () => {
    savedWordGroups = [{ userId: "u1", _count: { id: 4 } }];
    mockSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/u1", p256dh: "k", auth: "a" },
    ];
    mockReminderPrefs = [
      { userId: "u1", enabled: false, preferredHour: null, quietHoursStart: null, quietHoursEnd: null, timezone: null },
    ];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    const result = await sendDueReminders();
    assert.equal(result.usersWithDue, 1);
    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 0, "the user HAS a subscription, so not 'skipped'");
    assert.equal(result.suppressed, 1, "disabled preference should suppress the send");
    assert.equal(sendCalls.length, 0);
  });

  test("still sends to users with default (enabled) preferences", async () => {
    savedWordGroups = [{ userId: "u1", _count: { id: 2 } }];
    mockSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/u1", p256dh: "k", auth: "a" },
    ];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    const result = await sendDueReminders();
    assert.equal(result.sent, 1);
    assert.equal(result.suppressed, 0);
  });
});
