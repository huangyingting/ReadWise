process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let article: { id: string; wordCount: number | null } | null;
let upserts: Array<Record<string, unknown>>;
let events: Array<Record<string, unknown>>;
let analyticsThrows: boolean;
let operations: string[];

before(() => {
  mock.module("@/lib/article-library", {
    namedExports: {
      getPublicListableArticleById: async () => article,
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        placementResult: {
          upsert: async (input: Record<string, unknown>) => {
            operations.push("persist");
            upserts.push(input);
            return { id: "placement-1" };
          },
        },
      },
    },
  });
  mock.module("@/lib/analytics/events", {
    namedExports: {
      ANALYTICS_EVENT_TYPES: { placementCompleted: "placement_completed" },
      recordEvent: async (input: Record<string, unknown>) => {
        operations.push("analytics");
        events.push(input);
        if (analyticsThrows) throw new Error("analytics unavailable");
      },
    },
  });
});

beforeEach(() => {
  article = { id: "article-1", wordCount: 200 };
  upserts = [];
  events = [];
  analyticsThrows = false;
  operations = [];
});

async function submit(overrides: Partial<{
  articleId: string;
  seedLevel: "A2" | "B1" | "B2";
  correctCount: number;
  totalCount: number;
  lookupCount: number;
  skipped: boolean;
  attempt: "initial" | "retake";
}> = {}) {
  const { submitPlacementAttempt } = await import("@/lib/learning/placement-attempt");
  return submitPlacementAttempt("user-1", {
    articleId: "article-1",
    seedLevel: "B1",
    correctCount: 4,
    totalCount: 5,
    lookupCount: 3,
    ...overrides,
  });
}

test("rejects invalid counts before checking passage eligibility", async () => {
  article = null;
  const result = await submit({ correctCount: 6, totalCount: 5 });

  assert.deepEqual(result, { ok: false, reason: "invalid-counts" });
  assert.deepEqual(upserts, []);
  assert.deepEqual(events, []);
});

test("rejects zero-question non-skip attempts before checking passage eligibility", async () => {
  article = null;
  const result = await submit({ correctCount: 0, totalCount: 0 });

  assert.deepEqual(result, { ok: false, reason: "invalid-counts" });
  assert.deepEqual(upserts, []);
  assert.deepEqual(events, []);
});

test("rejects an article outside the public library without writing", async () => {
  article = null;
  const result = await submit();

  assert.deepEqual(result, { ok: false, reason: "article-not-public" });
  assert.deepEqual(upserts, []);
  assert.deepEqual(events, []);
});

test("scores up, holds, and down conservatively from authoritative word count", async () => {
  assert.deepEqual(await submit(), {
    ok: true,
    recommendedLevel: "B2",
    skipped: false,
  });
  assert.deepEqual(await submit({ correctCount: 3, lookupCount: 2 }), {
    ok: true,
    recommendedLevel: "B1",
    skipped: false,
  });
  assert.deepEqual(await submit({ correctCount: 5, lookupCount: 30 }), {
    ok: true,
    recommendedLevel: "A2",
    skipped: false,
  });
});

test("preserves scoring guards and recommendation endpoints", async () => {
  assert.deepEqual(await submit({ seedLevel: "A2", correctCount: 0 }), {
    ok: true,
    recommendedLevel: "A1",
    skipped: false,
  });
  assert.deepEqual(await submit({ seedLevel: "B2", correctCount: 5, lookupCount: 0 }), {
    ok: true,
    recommendedLevel: "C1",
    skipped: false,
  });
  article = { id: "article-1", wordCount: null };
  assert.deepEqual(await submit({ correctCount: 5 }), {
    ok: true,
    recommendedLevel: "B2",
    skipped: false,
  });
});

test("skip and retake upsert the same learner row with current semantics", async () => {
  const result = await submit({
    correctCount: 0,
    totalCount: 0,
    skipped: true,
    attempt: "retake",
  });

  assert.deepEqual(result, { ok: true, recommendedLevel: "B1", skipped: true });
  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0].where, { userId: "user-1" });
  const create = upserts[0].create as Record<string, unknown>;
  assert.equal(create.attempt, "retake");
  assert.equal(create.completedAt, null);
  assert.deepEqual(upserts[0].update, {
    passageArticleId: "article-1",
    seedLevel: "B1",
    recommendedLevel: "B1",
    questionCount: 0,
    correctCount: 0,
    lookupCount: 3,
    skipped: true,
    attempt: "retake",
    completedAt: null,
  });
});

test("persists only structured fields and emits metadata without article id", async () => {
  await submit();

  const create = upserts[0].create as Record<string, unknown>;
  assert.deepEqual(Object.keys(create).sort(), [
    "attempt",
    "completedAt",
    "correctCount",
    "lookupCount",
    "passageArticleId",
    "questionCount",
    "recommendedLevel",
    "seedLevel",
    "skipped",
    "userId",
  ].sort());
  assert.ok(!("articleId" in events[0]));
  assert.deepEqual(events[0].properties, {
    seedLevel: "B1",
    recommendedLevel: "B2",
    skipped: false,
    questionCount: 5,
    correctCount: 4,
    attempt: "initial",
  });
});

test("preserves persistence-before-analytics partial-success behavior", async () => {
  analyticsThrows = true;

  await assert.rejects(() => submit(), /analytics unavailable/);
  assert.deepEqual(operations, ["persist", "analytics"]);
  assert.equal(upserts.length, 1);
});