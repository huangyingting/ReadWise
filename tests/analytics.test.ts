/**
 * Product analytics ingestion tests (RW-051). No real DB — `@/lib/prisma` is
 * mocked and ingestion is force-enabled via ANALYTICS_ENABLED=1. Verifies that
 * `recordEvent` is best-effort (never throws), writes ONLY metadata (sensitive
 * keys are dropped), stamps the schema version, and that the retention / per-user
 * purge helpers issue the right deletes.
 */
process.env.LOG_LEVEL = "error"; // silence best-effort write warnings
process.env.ANALYTICS_ENABLED = "1"; // opt the write path in under tests

import { test, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";

type CreatedRecord = Record<string, unknown>;
let created: CreatedRecord[] = [];
let failWrite = false;
let deleteManyArgs: unknown[] = [];
let deleteManyCount = 0;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        analyticsEvent: {
          create: async (args: { data: CreatedRecord }) => {
            if (failWrite) throw new Error("simulated analytics write failure");
            created.push(args.data);
            return { id: "evt-1", ...args.data };
          },
          deleteMany: async (args: unknown) => {
            deleteManyArgs.push(args);
            return { count: deleteManyCount };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  created = [];
  failWrite = false;
  deleteManyArgs = [];
  deleteManyCount = 0;
});

after(() => {
  delete process.env.ANALYTICS_ENABLED;
});

// Keys that must NEVER reach the stream (free text / PII / secrets).
const FORBIDDEN_KEYS = [
  "text",
  "content",
  "word",
  "selection",
  "sentence",
  "translation",
  "definition",
  "prompt",
  "email",
  "token",
  "secret",
  "url",
];

test("recordEvent writes a metadata-only event with the schema version", async () => {
  const { recordEvent, ANALYTICS_EVENT_TYPES, ANALYTICS_SCHEMA_VERSION } = await import(
    "@/lib/analytics"
  );
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.articleView,
    userId: "user-1",
    articleId: "article-1",
    properties: { category: "science", difficulty: "B1", count: 3 },
  });
  assert.equal(created.length, 1);
  const rec = created[0];
  assert.equal(rec.type, "article_view");
  assert.equal(rec.userId, "user-1");
  assert.equal(rec.articleId, "article-1");
  const props = rec.properties as Record<string, unknown>;
  assert.equal(props._v, ANALYTICS_SCHEMA_VERSION);
  assert.equal(props.category, "science");
  assert.equal(props.count, 3);
});

test("recordEvent drops sensitive keys from properties", async () => {
  const { recordEvent } = await import("@/lib/analytics");
  await recordEvent({
    type: "article_view",
    userId: "user-1",
    properties: {
      ok: "keep",
      text: "the full article body should never be stored",
      selectedText: "a sensitive selection",
      email: "user@example.com",
      token: "secret-token",
      url: "https://example.com/secret",
    },
  });
  assert.equal(created.length, 1);
  const props = created[0].properties as Record<string, unknown>;
  assert.equal(props.ok, "keep");
  for (const key of Object.keys(props)) {
    for (const forbidden of FORBIDDEN_KEYS) {
      assert.ok(
        !key.toLowerCase().includes(forbidden),
        `sensitive key "${key}" leaked into analytics properties`,
      );
    }
  }
});

test("sanitizeEventProperties truncates long strings and drops nested objects", async () => {
  const { sanitizeEventProperties } = await import("@/lib/analytics");
  const props = sanitizeEventProperties({
    long: "x".repeat(500),
    nested: { a: 1 },
    list: ["a", "b", { bad: true }],
    flag: true,
    bad: NaN,
  });
  assert.equal((props.long as string).length, 200);
  assert.equal(props.nested, null);
  assert.deepEqual(props.list, ["a", "b", null]);
  assert.equal(props.flag, true);
  assert.equal(props.bad, null);
});

test("recordEvent never throws when the write fails (best-effort)", async () => {
  const { recordEvent } = await import("@/lib/analytics");
  failWrite = true;
  await assert.doesNotReject(() =>
    recordEvent({ type: "lookup", userId: "user-1", properties: { found: true } }),
  );
  assert.equal(created.length, 0);
});

test("recordEvent is a no-op when analytics is disabled", async () => {
  const { recordEvent } = await import("@/lib/analytics");
  process.env.ANALYTICS_ENABLED = "0";
  try {
    await recordEvent({ type: "lookup", userId: "user-1" });
    assert.equal(created.length, 0);
  } finally {
    process.env.ANALYTICS_ENABLED = "1";
  }
});

test("pruneOldEvents deletes events older than the cutoff", async () => {
  const { pruneOldEvents } = await import("@/lib/analytics");
  deleteManyCount = 7;
  const now = new Date("2026-06-01T00:00:00Z");
  const removed = await pruneOldEvents(30, undefined, now);
  assert.equal(removed, 7);
  assert.equal(deleteManyArgs.length, 1);
  const where = (deleteManyArgs[0] as { where: { occurredAt: { lt: Date } } }).where;
  const cutoff = where.occurredAt.lt;
  // 30 days before 2026-06-01 is 2026-05-02.
  assert.equal(cutoff.toISOString().slice(0, 10), "2026-05-02");
});

test("deleteEventsForUser purges a single user's events", async () => {
  const { deleteEventsForUser } = await import("@/lib/analytics");
  deleteManyCount = 3;
  const removed = await deleteEventsForUser("user-9");
  assert.equal(removed, 3);
  const where = (deleteManyArgs[0] as { where: { userId: string } }).where;
  assert.equal(where.userId, "user-9");
});

test("deleteEventsForUser is a no-op for an empty id", async () => {
  const { deleteEventsForUser } = await import("@/lib/analytics");
  const removed = await deleteEventsForUser("");
  assert.equal(removed, 0);
  assert.equal(deleteManyArgs.length, 0);
});
