/**
 * Route tests for POST /api/today/read-complete (#793).
 *
 * The manual Today-only reading fallback updates Today step state ONLY and must
 * never read or mutate ReadingProgress (the mock prisma has no readingProgress
 * delegate, so any access would throw). Mocks auth + prisma.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, jsonPost } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

type Row = Record<string, unknown>;

let authState: AuthState = "ok";
let sessionRow: Row | null = null;
const USER_ID = "user-1";
const LOCAL_DATE = "2026-06-27";

function makeRow(overrides: Row = {}): Row {
  return {
    id: "ts1",
    userId: USER_ID,
    localDate: LOCAL_DATE,
    timezoneSnapshot: "UTC",
    primaryArticleId: "a1",
    backupArticleIds: [],
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
            if (sessionRow.userId === k.userId && sessionRow.localDate === k.localDate) {
              return { ...sessionRow };
            }
            return null;
          },
          updateMany: async ({
            where,
            data,
          }: {
            where: { userId: string; localDate: string };
            data: Row;
          }) => {
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
        savedWord: { findMany: async () => [] },
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  sessionRow = null;
});

async function POST(body: unknown = {}) {
  const { POST: handler } = (await import(
    "@/app/api/today/read-complete/route"
  )) as { POST: RouteHandler };
  return handler(jsonPost("http://localhost/api/today/read-complete", body));
}

test("returns 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await POST({});
  assert.equal(res.status, 401);
});

test("marks the current primary read and reports completion state", async () => {
  sessionRow = makeRow({ primaryArticleId: "a1" });
  const res = await POST({ timezone: "UTC" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    updated: boolean;
    status: string;
    completionTier: string;
    completed: boolean;
  };
  assert.equal(body.updated, true);
  assert.equal(body.completionTier, "reading");
  assert.equal(body.status, "active");
  assert.ok(sessionRow.readingCompletedAt instanceof Date, "reading timestamp persisted");
});

test("returns updated:false when there is no Today session", async () => {
  sessionRow = null;
  const res = await POST({});
  assert.equal(res.status, 200);
  const body = (await res.json()) as { updated: boolean };
  assert.equal(body.updated, false);
});

test("returns updated:false on a no-candidate day (no primary article)", async () => {
  sessionRow = makeRow({ primaryArticleId: null });
  const res = await POST({});
  assert.equal(res.status, 200);
  const body = (await res.json()) as { updated: boolean };
  assert.equal(body.updated, false);
  assert.equal(sessionRow.readingCompletedAt, null);
});

test("rejects a non-string timezone with 400", async () => {
  const res = await POST({ timezone: 123 });
  assert.equal(res.status, 400);
});
