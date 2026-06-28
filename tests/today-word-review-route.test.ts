/**
 * Route tests for POST /api/today/word-review-complete (#811).
 *
 * The thin offline-replay endpoint exposes the existing
 * `markTodayWordReviewComplete` so the offline queue has a real target. It must
 * 401 unauthenticated, 404 when the Today feature flag is off, validate inputs,
 * scope every write to the authenticated user (never a body id), and be
 * IDEMPOTENT: `wordReviewCompletedAt` is monotonic (first write wins; a second
 * replay is a graceful no-op). Mocks auth + prisma — no real DB.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, jsonPost } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

type Row = Record<string, unknown>;

let authState: AuthState = "ok";
let sessionRow: Row | null = null;
let updateScopes: { userId: string; localDate: string }[] = [];
const USER_ID = "user-1";
// Anchored to the current UTC day so the pre-seeded Today session matches the
// localDate the route/generator resolves from `new Date()` (avoids date-rollover
// flakiness). Format matches dateKey(now, "UTC").
const LOCAL_DATE = new Date().toISOString().slice(0, 10);
const FLAG = "FEATURE_TODAY_SESSION_ENABLED";

function makeRow(overrides: Row = {}): Row {
  return {
    id: "ts1",
    userId: USER_ID,
    localDate: LOCAL_DATE,
    timezoneSnapshot: "UTC",
    primaryArticleId: "a1",
    backupArticleIds: [],
    targetSavedWordIds: ["w1"],
    reviewTargetCount: 1,
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
    createdAt: new Date("2026-06-27T00:00:00Z"),
    updatedAt: new Date("2026-06-27T00:00:00Z"),
    ...overrides,
  };
}

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: sessionAuthExports(() => authState),
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        profile: { findUnique: async () => ({ timezone: "UTC" }) },
        placementResult: { findUnique: async () => null },
        seriesEnrollment: {
          findFirst: async () => null,
          findUnique: async () => null,
        },
        todaySession: {
          findUnique: async ({
            where,
          }: {
            where: { userId_localDate: { userId: string; localDate: string } };
          }) => {
            const k = where.userId_localDate;
            if (!sessionRow) return null;
            return sessionRow.userId === k.userId && sessionRow.localDate === k.localDate
              ? { ...sessionRow }
              : null;
          },
          updateMany: async ({
            where,
            data,
          }: {
            where: { userId: string; localDate: string };
            data: Row;
          }) => {
            updateScopes.push({ userId: where.userId, localDate: where.localDate });
            if (
              !sessionRow ||
              sessionRow.userId !== where.userId ||
              sessionRow.localDate !== where.localDate
            ) {
              return { count: 0 };
            }
            Object.assign(sessionRow, data);
            return { count: 1 };
          },
        },
        // A single target word reviewed within the evidence window → review met.
        savedWord: {
          findMany: async () => [
            { id: "w1", lastReviewedAt: new Date("2026-06-27T06:00:00Z") },
          ],
        },
        analyticsEvent: { create: async () => ({ id: "evt" }) },
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  sessionRow = makeRow();
  updateScopes = [];
  process.env[FLAG] = "true";
});

async function POST(body: unknown = {}) {
  const { POST: handler } = (await import(
    "@/app/api/today/word-review-complete/route"
  )) as { POST: RouteHandler };
  return handler(
    jsonPost("http://localhost/api/today/word-review-complete", body),
  );
}

test("returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await POST({});
  assert.equal(res.status, 401);
});

test("returns 404 when the feature flag is disabled", async () => {
  process.env[FLAG] = "false";
  const res = await POST({});
  assert.equal(res.status, 404);
});

test("rejects a non-string timezone with 400", async () => {
  const res = await POST({ timezone: 123 });
  assert.equal(res.status, 400);
});

test("marks word-review complete and reports completion state", async () => {
  const res = await POST({ timezone: "UTC", localDate: LOCAL_DATE });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    updated: boolean;
    status: string;
    completionTier: string;
    completed: boolean;
  };
  assert.equal(body.updated, true);
  assert.ok(
    sessionRow!.wordReviewCompletedAt instanceof Date,
    "word-review timestamp persisted",
  );
  // Every write scoped to the authenticated user (never a body id).
  for (const scope of updateScopes) assert.equal(scope.userId, USER_ID);
});

test("is idempotent: a second replay is a monotonic no-op (first write wins)", async () => {
  const first = await POST({ timezone: "UTC" });
  assert.equal(first.status, 200);
  const firstTs = sessionRow!.wordReviewCompletedAt as Date;
  assert.ok(firstTs instanceof Date);

  const second = await POST({ timezone: "UTC" });
  assert.equal(second.status, 200);
  const secondTs = sessionRow!.wordReviewCompletedAt as Date;
  // Sticky: the completion timestamp is never overwritten by the replay.
  assert.equal(secondTs.getTime(), firstTs.getTime());
});

test("returns updated:false when there is no Today session", async () => {
  sessionRow = null;
  const res = await POST({});
  assert.equal(res.status, 200);
  const body = (await res.json()) as { updated: boolean };
  assert.equal(body.updated, false);
});

test("a skipped day is a graceful no-op (never overwrites the skip)", async () => {
  sessionRow = makeRow({ status: "skipped", skipped: true });
  const res = await POST({});
  assert.equal(res.status, 200);
  assert.equal(sessionRow!.status, "skipped");
});
