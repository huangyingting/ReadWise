/**
 * Route tests for POST /api/today/skip (#797).
 *
 * Validates auth, the feature-flag 404, controlled skip-reason validation,
 * cross-user isolation (the body can never choose another user's session), the
 * skip transition, and the daily skip-limit fallback. Mocks auth + prisma; an
 * existing session short-circuits generation.
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
const LOCAL_DATE = "2026-06-27";
const FLAG = "FEATURE_TODAY_SESSION_ENABLED";

function makeRow(overrides: Row = {}): Row {
  return {
    id: "ts1",
    userId: USER_ID,
    localDate: LOCAL_DATE,
    timezoneSnapshot: "UTC",
    primaryArticleId: "a1",
    backupArticleIds: ["b1", "b2"],
    targetSavedWordIds: [],
    reviewTargetCount: 0,
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
  const { POST: handler } = (await import("@/app/api/today/skip/route")) as {
    POST: RouteHandler;
  };
  return handler(jsonPost("http://localhost/api/today/skip", body));
}

test("returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await POST({ skipReason: "too_busy" });
  assert.equal(res.status, 401);
});

test("returns 404 when the feature flag is disabled", async () => {
  process.env[FLAG] = "false";
  const res = await POST({ skipReason: "too_busy" });
  assert.equal(res.status, 404);
});

test("rejects a missing skip reason with 400", async () => {
  const res = await POST({});
  assert.equal(res.status, 400);
});

test("rejects an invalid controlled skip reason with 400", async () => {
  const res = await POST({ skipReason: "made_up" });
  assert.equal(res.status, 400);
  assert.equal(sessionRow?.status, "active");
});

test("skips the day and reports the browse fallback + promoted backups", async () => {
  const res = await POST({ skipReason: "too_busy", timezone: "UTC" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    skipped: boolean;
    limitReached: boolean;
    browseFallback: boolean;
    status: string;
    promotedBackupIds: string[];
  };
  assert.equal(body.skipped, true);
  assert.equal(body.limitReached, false);
  assert.equal(body.browseFallback, true);
  assert.equal(body.status, "skipped");
  assert.deepEqual(body.promotedBackupIds, ["b1", "b2"]);
  // Every write scoped to the authenticated user (never a body id).
  for (const scope of updateScopes) assert.equal(scope.userId, USER_ID);
});

test("a second skip hits the daily limit and returns the browse fallback", async () => {
  await POST({ skipReason: "too_hard" });
  const res = await POST({ skipReason: "too_easy" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { skipped: boolean; limitReached: boolean };
  assert.equal(body.skipped, false);
  assert.equal(body.limitReached, true);
});

test("rejects a non-string timezone with 400", async () => {
  const res = await POST({ skipReason: "too_busy", timezone: 123 });
  assert.equal(res.status, 400);
});
