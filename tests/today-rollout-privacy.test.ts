/**
 * Today Session — rollout privacy regression coverage (#804).
 *
 * Locks in the cross-cutting guarantee that the Today rollout only ever
 * persists or emits IDS / ENUMS / COUNTS / FLAGS / TIMESTAMPS — never article
 * text, selected text, definitions, examples, context sentences, prompts,
 * private notes, tokens, or PII. It exercises all three rollout sinks through a
 * single shared metadata-only sanitizer:
 *
 *   (a) the persisted `TodaySession` row (the create + update chokepoint that
 *       every generate / complete / skip path funnels through);
 *   (b) every Today analytics event payload (allowlisted keys, controlled
 *       primitive values — extends the gate in tests/today-analytics.test.ts);
 *   (c) the Today push reminder payload (generic copy + a numeric count only).
 *
 * No real DB / network: `@/lib/prisma` and `web-push` are mocked.
 */
process.env.LOG_LEVEL = "error";
process.env.ANALYTICS_ENABLED = "1"; // opt the analytics write path in

import { test, before, beforeEach, after, mock, describe } from "node:test";
import assert from "node:assert/strict";

type Data = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Captured writes
// ---------------------------------------------------------------------------

let createdSession: Data | null = null;
let updatedSessionData: Data | null = null;
let storedRow: Data | null = null;
let analyticsEvents: Data[] = [];

let savedWordGroups: { userId: string; _count: { id: number } }[] = [];
let pushSubs: {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}[] = [];
let sendCalls: { endpoint: string; payload: string }[] = [];

function baseRow(overrides: Data = {}): Data {
  const now = new Date("2026-06-27T00:00:00Z");
  return {
    id: "ts1",
    userId: "u1",
    localDate: "2026-06-27",
    timezoneSnapshot: "UTC",
    primaryArticleId: "a1",
    backupArticleIds: ["a2", "a3"],
    targetSavedWordIds: ["w1", "w2"],
    reviewTargetCount: 2,
    status: "active",
    source: "picks",
    completionTier: "none",
    generationReasonCode: "picks_primary",
    readingCompletedAt: null,
    comprehensionCompletedAt: null,
    wordReviewCompletedAt: null,
    completedAt: null,
    skipped: false,
    skipReason: null,
    skippedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        todaySession: {
          findUnique: async () => storedRow,
          create: async ({ data }: { data: Data }) => {
            createdSession = data;
            storedRow = baseRow(data);
            return storedRow;
          },
          updateMany: async ({ data }: { data: Data }) => {
            updatedSessionData = data;
            if (storedRow) Object.assign(storedRow, data);
            return { count: 1 };
          },
        },
        analyticsEvent: {
          create: async ({ data }: { data: Data }) => {
            analyticsEvents.push(data);
            return { id: "evt-1", ...data };
          },
        },
        // Scheduler delegates (Today push reminder).
        savedWord: {
          groupBy: async () => savedWordGroups,
        },
        pushSubscription: {
          findMany: async () => pushSubs,
          deleteMany: async () => ({ count: 0 }),
          updateMany: async () => ({ count: 0 }),
        },
        reminderPreference: { findMany: async () => [] },
        profile: { findMany: async () => [], findUnique: async () => ({ timezone: "UTC" }) },
      },
    },
  });

  mock.module("web-push", {
    defaultExport: {
      setVapidDetails: () => {},
      sendNotification: async (sub: { endpoint: string }, payload: string) => {
        sendCalls.push({ endpoint: sub.endpoint, payload });
      },
    },
  });
});

beforeEach(() => {
  createdSession = null;
  updatedSessionData = null;
  storedRow = baseRow();
  analyticsEvents = [];
  savedWordGroups = [];
  pushSubs = [];
  sendCalls = [];
  process.env.VAPID_PUBLIC_KEY = "BFakePubKey1234567890abcdef";
  process.env.VAPID_PRIVATE_KEY = "FakePrivKey1234567890abcdef";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  process.env.FEATURE_TODAY_SESSION_ENABLED = "true";
});

after(() => {
  delete process.env.ANALYTICS_ENABLED;
  delete process.env.FEATURE_TODAY_SESSION_ENABLED;
});

// ---------------------------------------------------------------------------
// Shared metadata-only gate
// ---------------------------------------------------------------------------

/** Controlled-token shape: enums/ids/dates only — never free text/sentences. */
const CONTROLLED_TOKEN_RE = /^[A-Za-z0-9:_.-]+$/;

/**
 * A value is metadata-only when it is a null, number, boolean, Date, a short
 * controlled-token string (enum/id/date), or an array of such values. Any free
 * text (a title, definition, example, sentence, note) fails the token regex or
 * the length cap, and any nested object fails outright.
 */
function assertSafeValue(value: unknown, label: string): void {
  if (value === null || value === undefined) return;
  if (value instanceof Date) return;
  if (typeof value === "number" || typeof value === "boolean") return;
  if (typeof value === "string") {
    assert.ok(value.length <= 64, `over-long string for "${label}": ${value}`);
    assert.ok(
      CONTROLLED_TOKEN_RE.test(value),
      `non-token string "${value}" for "${label}"`,
    );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertSafeValue(item, `${label}[${i}]`));
    return;
  }
  assert.fail(`non-primitive value for "${label}": ${JSON.stringify(value)}`);
}

/** Assert a persisted/emitted record only carries allowlisted, safe-valued keys. */
function assertMetadataOnly(record: Data, allowed: Set<string>, where: string): void {
  for (const [key, value] of Object.entries(record)) {
    assert.ok(allowed.has(key), `unexpected key "${key}" in ${where}`);
    assertSafeValue(value, `${where}.${key}`);
  }
}

// ---------------------------------------------------------------------------
// (a) Persisted TodaySession row
// ---------------------------------------------------------------------------

describe("persisted TodaySession row is metadata-only", () => {
  // Columns the repository may write — ids/enums/counts/flags/timestamps only.
  const CREATE_KEYS = new Set([
    "userId",
    "localDate",
    "timezoneSnapshot",
    "primaryArticleId",
    "backupArticleIds",
    "targetSavedWordIds",
    "reviewTargetCount",
    "source",
    "generationReasonCode",
    "status",
    "completionTier",
  ]);
  const UPDATE_KEYS = new Set([
    "status",
    "completionTier",
    "backupArticleIds",
    "readingCompletedAt",
    "comprehensionCompletedAt",
    "wordReviewCompletedAt",
    "completedAt",
    "skipped",
    "skipReason",
    "skippedAt",
  ]);

  test("createTodaySession persists ids/enums/counts only", async () => {
    const { createTodaySession } = await import(
      "@/lib/engagement/today-session/repository"
    );
    await createTodaySession({
      userId: "u1",
      localDate: "2026-06-27",
      timezoneSnapshot: "UTC",
      plan: {
        primaryArticleId: "a1",
        backupArticleIds: ["a2", "a3"],
        targetSavedWordIds: ["w1", "w2", "w3"],
        reviewTargetCount: 3,
        source: "picks",
        generationReasonCode: "picks_primary",
      },
    });
    assert.ok(createdSession, "create data captured");
    assertMetadataOnly(createdSession!, CREATE_KEYS, "todaySession.create");
  });

  test("a completed-session update persists timestamps/enums/flags only", async () => {
    const { updateTodaySession } = await import(
      "@/lib/engagement/today-session/repository"
    );
    const now = new Date("2026-06-27T03:00:00Z");
    await updateTodaySession("u1", "2026-06-27", {
      status: "completed",
      completionTier: "full",
      readingCompletedAt: now,
      comprehensionCompletedAt: now,
      wordReviewCompletedAt: now,
      completedAt: now,
      backupArticleIds: ["a2", "a3"],
    });
    assert.ok(updatedSessionData, "update data captured");
    assertMetadataOnly(updatedSessionData!, UPDATE_KEYS, "todaySession.update(complete)");
  });

  test("a skipped-session update persists a controlled reason code only", async () => {
    const { updateTodaySession } = await import(
      "@/lib/engagement/today-session/repository"
    );
    await updateTodaySession("u1", "2026-06-27", {
      status: "skipped",
      skipped: true,
      skipReason: "too_hard",
      skippedAt: new Date("2026-06-27T04:00:00Z"),
    });
    assert.ok(updatedSessionData, "update data captured");
    assertMetadataOnly(updatedSessionData!, UPDATE_KEYS, "todaySession.update(skip)");
    assert.equal(updatedSessionData!.skipReason, "too_hard");
  });
});

// ---------------------------------------------------------------------------
// (b) Every Today analytics event payload
// ---------------------------------------------------------------------------

describe("Today analytics payloads are metadata-only", () => {
  // Allowed property keys across every Today event (controlled enums/counts/flags).
  const ALLOWED_PROPS = new Set([
    "_v",
    "source",
    "reasonCode",
    "tier",
    "method",
    "status",
    "hasPrimary",
    "isNoCandidate",
    "skipped",
    "hasTargetWords",
    "hadTargetWords",
    "backupCount",
    "targetWordCount",
    "targetCount",
    "reviewTargetCount",
    "limitReached",
    "browseFallback",
  ]);
  // Top-level event columns are id anchors + type + properties.
  const EVENT_ANCHOR_KEYS = new Set([
    "type",
    "userId",
    "anonymousId",
    "articleId",
    "sessionId",
    "occurredAt",
    "properties",
  ]);

  type TodaySessionView =
    import("@/lib/engagement/today-session/types").TodaySessionView;

  function makeSession(overrides: Partial<TodaySessionView> = {}): TodaySessionView {
    const now = new Date("2026-06-27T05:30:00Z");
    return {
      id: "today-1",
      userId: "user-1",
      localDate: "2026-06-27",
      timezoneSnapshot: "UTC",
      primaryArticleId: "article-1",
      backupArticleIds: ["article-2", "article-3"],
      targetSavedWordIds: ["w1", "w2", "w3"],
      reviewTargetCount: 3,
      status: "active",
      source: "picks",
      completionTier: "none",
      generationReasonCode: "picks_primary",
      readingCompletedAt: null,
      comprehensionCompletedAt: null,
      wordReviewCompletedAt: null,
      completedAt: null,
      skipped: false,
      skipReason: null,
      skippedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  test("the full Today event sweep emits only allowlisted, token-valued props", async () => {
    const a = await import("@/lib/engagement/today-session/analytics");
    const s = makeSession();

    await a.emitTodaySessionGenerated(s);
    await a.emitTodayNoCandidate(
      makeSession({
        primaryArticleId: null,
        backupArticleIds: [],
        targetSavedWordIds: [],
        source: "none",
        generationReasonCode: "no_candidate",
      }),
    );
    await a.emitTodaySessionViewed(makeSession({ status: "completed", completionTier: "full" }));
    await a.emitTodayReadingComplete(makeSession({ completionTier: "reading" }), "manual");
    await a.emitTodayComprehensionComplete(makeSession({ completionTier: "comprehension" }));
    await a.emitTodayWordReviewComplete(makeSession({ completionTier: "full" }), 3);
    await a.emitTodaySessionComplete(
      makeSession({ status: "completed", completionTier: "full" }),
      true,
    );
    await a.emitTodaySkip(
      makeSession({ status: "skipped", skipped: true, skipReason: "too_hard" }),
      { limitReached: false, browseFallback: true },
    );

    assert.equal(analyticsEvents.length, 8, "every emit helper wrote one event");
    for (const rec of analyticsEvents) {
      // Top-level columns are id anchors / type / properties only.
      for (const key of Object.keys(rec)) {
        assert.ok(EVENT_ANCHOR_KEYS.has(key), `unexpected event column "${key}"`);
      }
      assertSafeValue(rec.type, "event.type");
      assertSafeValue(rec.userId, "event.userId");
      assertSafeValue(rec.anonymousId, "event.anonymousId");
      assertSafeValue(rec.articleId, "event.articleId");
      assertSafeValue(rec.sessionId, "event.sessionId");
      // The properties bag is gated by the per-event allowlist + safe values.
      assertMetadataOnly(
        rec.properties as Data,
        ALLOWED_PROPS,
        `${String(rec.type)}.properties`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// (c) Today push reminder payload
// ---------------------------------------------------------------------------

describe("Today push reminder payload is content-safe", () => {
  test("carries only generic copy + a numeric count (deep-linked to /today)", async () => {
    savedWordGroups = [{ userId: "u1", _count: { id: 3 } }];
    pushSubs = [
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/u1", p256dh: "k", auth: "a" },
    ];
    const { sendDueReminders } = await import("@/lib/push/scheduler");
    await sendDueReminders();

    assert.equal(sendCalls.length, 1);
    const payload = JSON.parse(sendCalls[0].payload) as Record<string, string>;
    // Generic notification shape only — no per-content keys.
    assert.deepEqual(Object.keys(payload).sort(), ["body", "icon", "title", "url"]);
    assert.equal(payload.url, "/today", "Today reminder deep-links to /today when enabled");
    // The body mentions a numeric due count, never any article/word content.
    assert.match(payload.body, /\b3\b/);
    assert.doesNotMatch(
      payload.body,
      /title|note|definition|example|sentence|article:/i,
    );
  });
});
