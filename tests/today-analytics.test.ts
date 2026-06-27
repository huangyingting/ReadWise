/**
 * Today Session product analytics tests (#802).
 *
 * No real DB — `@/lib/prisma` is mocked and ingestion is force-enabled via
 * ANALYTICS_ENABLED=1. Verifies that:
 *   - the new Today event types exist in the catalog with their canonical
 *     string values;
 *   - every Today emit helper writes a metadata-only event (ids/enums/counts/
 *     booleans ONLY) carrying the right type + id anchors;
 *   - no article/word content, definitions, notes, or PII can enter a payload
 *     (the helpers only read controlled fields, and the sanitizer is a backstop).
 */
process.env.LOG_LEVEL = "error"; // silence best-effort write warnings
process.env.ANALYTICS_ENABLED = "1"; // opt the write path in under tests

import { test, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";

type CreatedRecord = Record<string, unknown>;
let created: CreatedRecord[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        analyticsEvent: {
          create: async (args: { data: CreatedRecord }) => {
            created.push(args.data);
            return { id: "evt-1", ...args.data };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  created = [];
});

after(() => {
  delete process.env.ANALYTICS_ENABLED;
});

// Keys a Today payload is allowed to carry (controlled enums/ids/counts/flags).
// This allowlist IS the privacy gate: any key outside it fails the test, so no
// content/PII field name can ever slip into a Today event payload.
const ALLOWED_KEYS = new Set([
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

/** Controlled-token shape: enums/ids/dates only — never free text/sentences. */
const CONTROLLED_TOKEN_RE = /^[A-Za-z0-9:_.-]+$/;

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

/** Assert a persisted event is metadata-only with safe primitive values. */
function assertPrivacySafe(rec: CreatedRecord) {
  const props = rec.properties as Record<string, unknown>;
  for (const [key, value] of Object.entries(props)) {
    // Every key must be on the controlled allowlist (no content/PII field names).
    assert.ok(
      ALLOWED_KEYS.has(key),
      `unexpected analytics key "${key}" in ${String(rec.type)}`,
    );
    // Values must be small primitives — never nested objects/arrays/content.
    const t = typeof value;
    assert.ok(
      value === null || t === "number" || t === "boolean" || t === "string",
      `non-primitive value for "${key}" in ${String(rec.type)}`,
    );
    // String values must be short controlled tokens (enums/ids) — this rejects
    // any free text such as article titles, definitions, sentences, or notes.
    if (typeof value === "string") {
      assert.ok(value.length <= 64, `over-long string for "${key}"`);
      assert.ok(
        CONTROLLED_TOKEN_RE.test(value),
        `non-token string "${value}" for "${key}" in ${String(rec.type)}`,
      );
    }
  }
}

test("catalog exposes the Today event types with canonical string values", async () => {
  const { ANALYTICS_EVENT_TYPES, ALL_ANALYTICS_EVENT_TYPES } = await import(
    "@/lib/analytics/events"
  );
  const expected: Record<string, string> = {
    todaySessionGenerated: "today_session_generated",
    todaySessionViewed: "today_session_viewed",
    todayNoCandidate: "today_no_candidate",
    todayReadingComplete: "today_reading_complete",
    todayComprehensionComplete: "today_comprehension_complete",
    todayWordReviewComplete: "today_word_review_complete",
    todaySessionComplete: "today_session_complete",
    todaySkip: "today_skip",
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(
      (ANALYTICS_EVENT_TYPES as Record<string, string>)[key],
      value,
      `missing/incorrect catalog entry for ${key}`,
    );
    assert.ok(
      ALL_ANALYTICS_EVENT_TYPES.includes(value as never),
      `${value} not in ALL_ANALYTICS_EVENT_TYPES`,
    );
  }
});

test("emitTodaySessionGenerated writes safe metadata + id anchors", async () => {
  const { emitTodaySessionGenerated } = await import(
    "@/lib/engagement/today-session/analytics"
  );
  await emitTodaySessionGenerated(makeSession());
  assert.equal(created.length, 1);
  const rec = created[0];
  assert.equal(rec.type, "today_session_generated");
  assert.equal(rec.userId, "user-1");
  assert.equal(rec.articleId, "article-1");
  assert.equal(rec.sessionId, "today-1");
  const props = rec.properties as Record<string, unknown>;
  assert.equal(props.source, "picks");
  assert.equal(props.reasonCode, "picks_primary");
  assert.equal(props.hasPrimary, true);
  assert.equal(props.backupCount, 2);
  assert.equal(props.targetWordCount, 3);
  assertPrivacySafe(rec);
});

test("emitTodayNoCandidate records the browse/import branch only", async () => {
  const { emitTodayNoCandidate } = await import(
    "@/lib/engagement/today-session/analytics"
  );
  await emitTodayNoCandidate(
    makeSession({
      primaryArticleId: null,
      backupArticleIds: [],
      targetSavedWordIds: [],
      source: "none",
      generationReasonCode: "no_candidate",
    }),
  );
  const rec = created[0];
  assert.equal(rec.type, "today_no_candidate");
  assert.equal(rec.articleId, null);
  const props = rec.properties as Record<string, unknown>;
  assert.equal(props.reasonCode, "no_candidate");
  assert.equal(props.source, "none");
  assertPrivacySafe(rec);
});

test("emitTodaySessionViewed carries status/source/tier flags", async () => {
  const { emitTodaySessionViewed } = await import(
    "@/lib/engagement/today-session/analytics"
  );
  await emitTodaySessionViewed(
    makeSession({ status: "completed", completionTier: "full" }),
  );
  const rec = created[0];
  assert.equal(rec.type, "today_session_viewed");
  const props = rec.properties as Record<string, unknown>;
  assert.equal(props.status, "completed");
  assert.equal(props.tier, "full");
  assert.equal(props.hasPrimary, true);
  assert.equal(props.isNoCandidate, false);
  assertPrivacySafe(rec);
});

test("emitTodayReadingComplete records the completion method", async () => {
  const { emitTodayReadingComplete } = await import(
    "@/lib/engagement/today-session/analytics"
  );
  await emitTodayReadingComplete(
    makeSession({ completionTier: "reading" }),
    "manual",
  );
  const rec = created[0];
  assert.equal(rec.type, "today_reading_complete");
  const props = rec.properties as Record<string, unknown>;
  assert.equal(props.method, "manual");
  assert.equal(props.tier, "reading");
  assert.equal(props.hasTargetWords, true);
  assertPrivacySafe(rec);
});

test("emitTodayComprehensionComplete carries the tier only", async () => {
  const { emitTodayComprehensionComplete } = await import(
    "@/lib/engagement/today-session/analytics"
  );
  await emitTodayComprehensionComplete(
    makeSession({ completionTier: "comprehension" }),
  );
  const rec = created[0];
  assert.equal(rec.type, "today_comprehension_complete");
  assert.equal((rec.properties as Record<string, unknown>).tier, "comprehension");
  assertPrivacySafe(rec);
});

test("emitTodayWordReviewComplete records a target COUNT, never the words", async () => {
  const { emitTodayWordReviewComplete } = await import(
    "@/lib/engagement/today-session/analytics"
  );
  await emitTodayWordReviewComplete(makeSession({ completionTier: "full" }), 3);
  const rec = created[0];
  assert.equal(rec.type, "today_word_review_complete");
  const props = rec.properties as Record<string, unknown>;
  assert.equal(props.targetCount, 3);
  assert.equal(props.tier, "full");
  assertPrivacySafe(rec);
});

test("emitTodaySessionComplete records tier + hadTargetWords", async () => {
  const { emitTodaySessionComplete } = await import(
    "@/lib/engagement/today-session/analytics"
  );
  await emitTodaySessionComplete(
    makeSession({ status: "completed", completionTier: "full" }),
    true,
  );
  const rec = created[0];
  assert.equal(rec.type, "today_session_complete");
  const props = rec.properties as Record<string, unknown>;
  assert.equal(props.tier, "full");
  assert.equal(props.hadTargetWords, true);
  assertPrivacySafe(rec);
});

test("emitTodaySkip records a controlled reason code only", async () => {
  const { emitTodaySkip } = await import(
    "@/lib/engagement/today-session/analytics"
  );
  await emitTodaySkip(
    makeSession({ status: "skipped", skipped: true, skipReason: "too_hard" }),
    { limitReached: false, browseFallback: true },
  );
  const rec = created[0];
  assert.equal(rec.type, "today_skip");
  const props = rec.properties as Record<string, unknown>;
  assert.equal(props.reasonCode, "too_hard");
  assert.equal(props.limitReached, false);
  assert.equal(props.browseFallback, true);
  assertPrivacySafe(rec);
});

test("Today emit helpers never throw (best-effort) when the write fails", async () => {
  const analytics = await import("@/lib/engagement/today-session/analytics");
  const session = makeSession();
  // Force the underlying write to throw; helpers must swallow it.
  created = [];
  const original = (await import("@/lib/prisma")) as unknown as {
    prisma: { analyticsEvent: { create: (a: unknown) => Promise<unknown> } };
  };
  const prevCreate = original.prisma.analyticsEvent.create;
  original.prisma.analyticsEvent.create = async () => {
    throw new Error("simulated write failure");
  };
  try {
    await assert.doesNotReject(() => analytics.emitTodaySessionGenerated(session));
    await assert.doesNotReject(() => analytics.emitTodaySkip(session, {
      limitReached: false,
      browseFallback: true,
    }));
  } finally {
    original.prisma.analyticsEvent.create = prevCreate;
  }
});
