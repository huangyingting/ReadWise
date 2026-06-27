/**
 * Route tests for `/api/placement` (#806).
 *
 * Covers: 401 unauthenticated, 400 invalid body, 404 article-not-in-library,
 * idempotent upsert (no duplicate row), skip path (skipped=true), and the
 * privacy contract (no passage/question/answer text or PII in the persisted row
 * or the analytics payload). Mocks auth, prisma, article-library, analytics, and
 * the passage loader. The pure scorer (`@/lib/learning/placement`) is real.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, jsonPost, getReq } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

// ---- mutable state --------------------------------------------------------

let authState: AuthState = "ok";
let articleExists = true;
let articleWordCount: number | null = 200;
let upsertCalls: Array<Record<string, unknown>> = [];
let createCalls = 0;
let recordedEvents: Array<Record<string, unknown>> = [];
let passageResult: unknown = null;

// ---- mocks ----------------------------------------------------------------

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        placementResult: {
          upsert: async (args: Record<string, unknown>) => {
            upsertCalls.push(args);
            return { id: "pr-1", userId: "user-1" };
          },
          create: async () => {
            createCalls += 1;
            throw new Error("create must not be called — placement is upserted");
          },
        },
      },
    },
  });

  mock.module("@/lib/article-library", {
    namedExports: {
      getPublicListableArticleById: async () =>
        articleExists ? { id: "a1", wordCount: articleWordCount } : null,
    },
  });

  mock.module("@/lib/analytics/events", {
    namedExports: {
      ANALYTICS_EVENT_TYPES: { placementCompleted: "placement_completed" },
      recordEvent: async (event: Record<string, unknown>) => {
        recordedEvents.push(event);
      },
    },
  });

  mock.module("@/lib/learning/placement-passage", {
    namedExports: {
      loadPlacementPassage: async () => passageResult,
    },
  });
});

beforeEach(() => {
  authState = "ok";
  articleExists = true;
  articleWordCount = 200;
  upsertCalls = [];
  createCalls = 0;
  recordedEvents = [];
  passageResult = null;
});

// ---- helpers ---------------------------------------------------------------

const validBody = {
  articleId: "a1",
  correctCount: 4,
  totalCount: 5,
  lookupCount: 3,
  seedLevel: "B1",
};

async function POST(body: unknown) {
  const { POST: handler } = (await import("@/app/api/placement/route")) as {
    POST: RouteHandler;
  };
  return handler(jsonPost("http://localhost/api/placement", body));
}

async function GET(seedLevel?: string) {
  const { GET: handler } = (await import("@/app/api/placement/route")) as {
    GET: RouteHandler;
  };
  const qs = seedLevel === undefined ? "" : `?seedLevel=${encodeURIComponent(seedLevel)}`;
  return handler(getReq(`http://localhost/api/placement${qs}`));
}

// ---- POST: auth / validation / 404 ----------------------------------------

test("POST 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await POST(validBody);
  assert.equal(res.status, 401);
  assert.equal(upsertCalls.length, 0);
});

test("POST 400 on invalid seedLevel", async () => {
  const res = await POST({ ...validBody, seedLevel: "C2" });
  assert.equal(res.status, 400);
  assert.equal(upsertCalls.length, 0);
});

test("POST 400 on missing required field", async () => {
  const { seedLevel: _omit, ...rest } = validBody;
  const res = await POST(rest);
  assert.equal(res.status, 400);
});

test("POST 400 when correctCount exceeds totalCount", async () => {
  const res = await POST({ ...validBody, correctCount: 9, totalCount: 5 });
  assert.equal(res.status, 400);
  assert.equal(upsertCalls.length, 0);
});

test("POST 404 when article is not in the public library", async () => {
  articleExists = false;
  const res = await POST(validBody);
  assert.equal(res.status, 404);
  assert.equal(upsertCalls.length, 0);
});

// ---- POST: scoring + upsert ------------------------------------------------

test("POST scores and upserts a recommended level", async () => {
  const res = await POST(validBody); // 4/5 = 0.8, lookups 3/200 = 0.015 → up
  assert.equal(res.status, 200);
  const json = (await res.json()) as { ok: boolean; recommendedLevel: string };
  assert.equal(json.ok, true);
  assert.equal(json.recommendedLevel, "B2");
  assert.equal(upsertCalls.length, 1);
  const where = upsertCalls[0].where as { userId: string };
  assert.equal(where.userId, "user-1");
});

test("POST is idempotent: second submit upserts, never creates a duplicate", async () => {
  await POST(validBody);
  await POST({ ...validBody, correctCount: 2, attempt: "retake" });
  assert.equal(upsertCalls.length, 2);
  assert.equal(createCalls, 0);
  // Both submissions key on the same single per-user row.
  for (const call of upsertCalls) {
    assert.equal((call.where as { userId: string }).userId, "user-1");
  }
  const second = upsertCalls[1].update as Record<string, unknown>;
  assert.equal(second.attempt, "retake");
});

test("POST skip stores skipped=true and coerces recommendedLevel to seed", async () => {
  const res = await POST({ ...validBody, skipped: true });
  assert.equal(res.status, 200);
  const json = (await res.json()) as { skipped: boolean; recommendedLevel: string };
  assert.equal(json.skipped, true);
  assert.equal(json.recommendedLevel, "B1"); // seed level
  const create = upsertCalls[0].create as Record<string, unknown>;
  assert.equal(create.skipped, true);
  assert.equal(create.recommendedLevel, "B1");
  assert.equal(create.completedAt, null);
});

// ---- POST: privacy ---------------------------------------------------------

const ALLOWED_ROW_KEYS = new Set([
  "userId",
  "passageArticleId",
  "seedLevel",
  "recommendedLevel",
  "questionCount",
  "correctCount",
  "lookupCount",
  "skipped",
  "attempt",
  "completedAt",
]);

test("PRIVACY: persisted row holds only structured counts/levels — no text/PII", async () => {
  await POST(validBody);
  const create = upsertCalls[0].create as Record<string, unknown>;
  for (const key of Object.keys(create)) {
    assert.ok(ALLOWED_ROW_KEYS.has(key), `unexpected stored field: ${key}`);
  }
  // No free-text/answer fields ever stored.
  for (const banned of [
    "passageText",
    "questionText",
    "question",
    "answers",
    "answerText",
    "options",
    "lookupWords",
    "words",
    "definitions",
    "content",
    "note",
  ]) {
    assert.ok(!(banned in create), `banned field present: ${banned}`);
  }
});

test("PRIVACY: analytics payload carries no article id and no free text", async () => {
  await POST(validBody);
  assert.equal(recordedEvents.length, 1);
  const event = recordedEvents[0];
  assert.equal(event.type, "placement_completed");
  // No article id anywhere on the event.
  assert.ok(!("articleId" in event), "event must not include articleId");
  const props = event.properties as Record<string, unknown>;
  const allowedProps = new Set([
    "seedLevel",
    "recommendedLevel",
    "skipped",
    "questionCount",
    "correctCount",
    "attempt",
  ]);
  for (const key of Object.keys(props)) {
    assert.ok(allowedProps.has(key), `unexpected analytics prop: ${key}`);
  }
});

// ---- GET: passage selection ------------------------------------------------

test("GET 400 on missing seedLevel", async () => {
  const res = await GET();
  assert.equal(res.status, 400);
});

test("GET returns available:false when no passage exists", async () => {
  passageResult = null;
  const res = await GET("B1");
  assert.equal(res.status, 200);
  const json = (await res.json()) as { available: boolean };
  assert.equal(json.available, false);
});

test("GET returns a passage when one is available", async () => {
  passageResult = {
    articleId: "a1",
    seedLevel: "B1",
    title: "T",
    excerpt: "E",
    wordCount: 180,
    questions: [
      { id: "q1", question: "?", options: ["a", "b"], correctIndex: 0 },
      { id: "q2", question: "?", options: ["a", "b"], correctIndex: 1 },
      { id: "q3", question: "?", options: ["a", "b"], correctIndex: 0 },
    ],
  };
  const res = await GET("B1");
  assert.equal(res.status, 200);
  const json = (await res.json()) as { available: boolean; passage: { articleId: string } };
  assert.equal(json.available, true);
  assert.equal(json.passage.articleId, "a1");
});
