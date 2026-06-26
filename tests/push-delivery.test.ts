/**
 * Tests for push delivery: isPushConfigured, vapidPublicKey, sendPushToUser
 * and the delivery-tracking / resilient-pruning contracts (RW-045).
 *
 * Mocks: web-push, @/lib/prisma.
 * No real VAPID keys or network I/O.
 */
import { test, before, beforeEach, mock, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mutable state shared by mock implementations
// ---------------------------------------------------------------------------

let setVapidThrows = false;

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

let deletedSubIds: string[][] = [];
let deletedManyEndpoints: string[][] = [];
let updatedManyCalls: { ids?: string[]; data: Record<string, unknown> }[] = [];

// ---------------------------------------------------------------------------
// Mocks registered once in before()
// ---------------------------------------------------------------------------

before(() => {
  mock.module("web-push", {
    defaultExport: {
      setVapidDetails: () => {
        if (setVapidThrows) throw new Error("bad VAPID config");
      },
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
            if (args.where?.endpoint) {
              deletedManyEndpoints.push([args.where.endpoint]);
              mockSubs = mockSubs.filter((s) => s.endpoint !== args.where?.endpoint);
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
          groupBy: async () => [],
        },
        reminderPreference: {
          findMany: async () => [],
        },
        profile: {
          findMany: async () => [],
        },
      },
    },
  });
});

beforeEach(() => {
  setVapidThrows = false;
  mockSubs = [];
  sendCalls = [];
  sendShouldFail = false;
  deletedSubIds = [];
  deletedManyEndpoints = [];
  updatedManyCalls = [];

  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

function enablePush() {
  process.env.VAPID_PUBLIC_KEY = "BFakePubKey1234567890abcdef";
  process.env.VAPID_PRIVATE_KEY = "FakePrivKey1234567890abcdef";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
}

// ---------------------------------------------------------------------------
// isPushConfigured
// ---------------------------------------------------------------------------

describe("isPushConfigured", () => {
  test("returns false when env vars are missing", async () => {
    const { isPushConfigured } = await import("@/lib/push/provider");
    assert.equal(isPushConfigured(), false);
  });

  test("returns true when all VAPID env vars are set", async () => {
    enablePush();
    const { isPushConfigured } = await import("@/lib/push/provider");
    assert.equal(isPushConfigured(), true);
  });

  test("returns false when web-push rejects VAPID details", async () => {
    enablePush();
    process.env.VAPID_PUBLIC_KEY = "BDifferentRejectedPublicKey";
    setVapidThrows = true;

    const { isPushConfigured } = await import("@/lib/push/provider");
    const { sendPushToUser } = await import("@/lib/push/delivery");

    assert.equal(isPushConfigured(), false);
    const sent = await sendPushToUser("user-1", { title: "Hi", body: "Test" });
    assert.equal(sent, 0);
    assert.equal(sendCalls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// vapidPublicKey
// ---------------------------------------------------------------------------

describe("vapidPublicKey", () => {
  test("returns null when unconfigured", async () => {
    const { vapidPublicKey } = await import("@/lib/push/provider");
    assert.equal(vapidPublicKey(), null);
  });

  test("returns the public key string when configured", async () => {
    enablePush();
    const { vapidPublicKey } = await import("@/lib/push/provider");
    assert.equal(vapidPublicKey(), "BFakePubKey1234567890abcdef");
  });
});

// ---------------------------------------------------------------------------
// sendPushToUser
// ---------------------------------------------------------------------------

describe("sendPushToUser", () => {
  test("returns 0 and no-ops when VAPID unconfigured", async () => {
    const { sendPushToUser } = await import("@/lib/push/delivery");
    const sent = await sendPushToUser("user-1", { title: "Hi", body: "Test" });
    assert.equal(sent, 0);
    assert.equal(sendCalls.length, 0);
  });

  test("returns 0 when the user has no subscriptions", async () => {
    enablePush();
    const { sendPushToUser } = await import("@/lib/push/delivery");
    const sent = await sendPushToUser("user-no-subs", { title: "Hi", body: "Test" });
    assert.equal(sent, 0);
    assert.equal(sendCalls.length, 0);
  });

  test("sends to all subscriptions of a user", async () => {
    enablePush();
    mockSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/1", p256dh: "k1", auth: "a1" },
      { id: "s2", userId: "u1", endpoint: "https://push.example.com/2", p256dh: "k2", auth: "a2" },
    ];
    const { sendPushToUser } = await import("@/lib/push/delivery");
    const sent = await sendPushToUser("u1", { title: "Review", body: "3 words due" });
    assert.equal(sent, 2);
    assert.equal(sendCalls.length, 2);
    const payload = JSON.parse(sendCalls[0].payload);
    assert.equal(payload.title, "Review");
    assert.equal(payload.body, "3 words due");
  });

  test("prunes dead 410 subscriptions", async () => {
    enablePush();
    mockSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/dead", p256dh: "k1", auth: "a1" },
      { id: "s2", userId: "u1", endpoint: "https://push.example.com/alive", p256dh: "k2", auth: "a2" },
    ];
    sendShouldFail = 410;
    const { sendPushToUser } = await import("@/lib/push/delivery");
    const sent = await sendPushToUser("u1", { title: "T", body: "B" });

    assert.equal(sent, 0);
    const flattened = deletedSubIds.flat();
    assert.ok(flattened.includes("s1"), "s1 should be pruned");
    assert.ok(flattened.includes("s2"), "s2 should be pruned");
  });

  test("does not prune 500-error subscriptions", async () => {
    enablePush();
    mockSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/err", p256dh: "k1", auth: "a1" },
    ];
    sendShouldFail = 500;
    const { sendPushToUser } = await import("@/lib/push/delivery");
    await sendPushToUser("u1", { title: "T", body: "B" });
    assert.equal(deletedSubIds.length, 0);
    assert.equal(mockSubs.length, 1, "subscription should NOT be pruned on 500");
  });
});

// ---------------------------------------------------------------------------
// Delivery tracking & resilient pruning (RW-045)
// ---------------------------------------------------------------------------

describe("delivery tracking and resilient pruning (RW-045)", () => {
  test("successful send resets failureCount and stamps lastSuccessAt", async () => {
    enablePush();
    mockSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/ok", p256dh: "k", auth: "a", failureCount: 3 },
    ];
    const { sendPushToUser } = await import("@/lib/push/delivery");
    await sendPushToUser("u1", { title: "T", body: "B" });

    const success = updatedManyCalls.find(
      (c) => c.ids?.includes("s1") && c.data.failureCount === 0,
    );
    assert.ok(success, "expected an updateMany resetting failureCount to 0");
    assert.ok("lastSuccessAt" in success!.data, "expected lastSuccessAt to be stamped");
    assert.equal(deletedSubIds.flat().length, 0, "healthy sub must not be pruned");
  });

  test("transient failure increments failureCount without pruning (below threshold)", async () => {
    enablePush();
    mockSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/err", p256dh: "k", auth: "a", failureCount: 0 },
    ];
    sendShouldFail = 500;
    const { sendPushToUser } = await import("@/lib/push/delivery");
    await sendPushToUser("u1", { title: "T", body: "B" });

    const failUpdate = updatedManyCalls.find((c) => c.ids?.includes("s1"));
    assert.ok(failUpdate, "expected an updateMany for the failed sub");
    assert.deepEqual(failUpdate!.data.failureCount, { increment: 1 });
    assert.equal(deletedSubIds.flat().length, 0, "must not prune below the failure threshold");
  });

  test("transient failure at the threshold prunes the unhealthy endpoint", async () => {
    enablePush();
    mockSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/dying", p256dh: "k", auth: "a", failureCount: 7 },
    ];
    sendShouldFail = 500;
    const { sendPushToUser } = await import("@/lib/push/delivery");
    await sendPushToUser("u1", { title: "T", body: "B" });

    assert.ok(deletedSubIds.flat().includes("s1"), "sub at the failure threshold should be pruned");
  });
});
