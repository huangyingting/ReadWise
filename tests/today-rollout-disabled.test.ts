/**
 * Today Session — rollout disabled-state regression coverage (#804).
 *
 * Locks in the cross-cutting guarantee that flipping
 * `FEATURE_TODAY_SESSION_ENABLED` OFF reverts every Today surface to its
 * pre-Today behavior. The summary route (#797) and skip route (#800) already
 * carry their own flag-404 tests, and the learner-landing resolver (#799) and
 * push scheduler deep-link (#803) are covered in their own suites; this file
 * adds the regressions that were still missing:
 *
 *   - POST /api/today/read-complete 404s when the feature is disabled (the
 *     route previously processed the request unconditionally) and is reachable
 *     when enabled.
 *   - The Dashboard Today card degrades away cleanly: the dashboard view model
 *     yields `todaySummary: null` (so the card is never rendered) and never
 *     loads a Today view model when the feature is off, and wires it through
 *     when the feature is on.
 *
 * The `/today` page and the `DashboardTodayCard` component are `.tsx` (JSX) and
 * cannot be imported by the strip-types test runner; their flag gates reuse the
 * exact `isTodaySessionFeatureEnabled()` helper exercised here and in
 * tests/feature-flags.test.ts, and the card's visibility is driven entirely by
 * the `todaySummary` value asserted below.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, afterEach, mock, describe } from "node:test";
import assert from "node:assert/strict";
import { type RouteHandler, jsonPost } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

const FLAG = "FEATURE_TODAY_SESSION_ENABLED";
const USER_ID = "user-1";
const LOCAL_DATE = "2026-06-27";

type Row = Record<string, unknown>;

let authState: AuthState = "ok";
let sessionRow: Row | null = null;

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

// Captures the call into loadTodayViewModel so the dashboard tests can assert
// the Today summary is only ever loaded when the feature is enabled.
let todayViewModelCalls = 0;
const TODAY_VM_SENTINEL = {
  status: "active",
  completionTier: "none",
  isNoCandidate: false,
  primaryReadable: true,
  primaryArticle: { id: "a1", title: "Title a1" },
  steps: {
    reading: { state: "available" },
    comprehension: { state: "unavailable" },
    wordReview: { state: "unavailable" },
  },
} as const;

before(() => {
  // ---- Route mocks (POST /api/today/read-complete) ------------------------
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
        analyticsEvent: { create: async () => ({ id: "evt-1" }) },
      },
    },
  });

  // ---- Dashboard view-model dependency mocks ------------------------------
  // The real implementations all import Prisma; mocking the barrels keeps the
  // view model pure so the only behavior under test is the Today flag gate.
  mock.module("@/lib/engagement", {
    namedExports: {
      listInProgressArticles: async () => [],
      getProgressSummaries: async () => ({}),
      getStreakSummary: async () => ({ currentStreak: 0 }),
    },
  });
  mock.module("@/lib/learning/quiz-mastery", {
    namedExports: { getQuizMastery: async () => ({}) },
  });
  mock.module("@/lib/learning/flashcards", {
    namedExports: { getReviewSummary: async () => ({ dueCount: 0 }) },
  });
  mock.module("@/lib/article-library", {
    namedExports: { getBookmarkedArticleIds: async () => new Set<string>() },
  });
  mock.module("@/features/profile-preferences/repository", {
    namedExports: { getProfile: async () => null },
  });
  mock.module("@/features/profile-preferences/schema", {
    namedExports: { parseTopics: () => [] },
  });
  mock.module("@/lib/feed", {
    namedExports: {
      getPersonalizedFeed: async () => ({ articles: [], hasMore: false }),
    },
  });
  mock.module("@/lib/engagement/today-session", {
    namedExports: {
      loadTodayViewModel: async () => {
        todayViewModelCalls += 1;
        return TODAY_VM_SENTINEL;
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  sessionRow = makeRow();
  todayViewModelCalls = 0;
  process.env[FLAG] = "true";
});

afterEach(() => {
  delete process.env[FLAG];
});

// ---------------------------------------------------------------------------
// POST /api/today/read-complete respects the kill switch
// ---------------------------------------------------------------------------

describe("POST /api/today/read-complete disabled-state", () => {
  async function POST(body: unknown = {}) {
    const { POST: handler } = (await import(
      "@/app/api/today/read-complete/route"
    )) as { POST: RouteHandler };
    return handler(jsonPost("http://localhost/api/today/read-complete", body));
  }

  test("returns 404 when the feature flag is disabled", async () => {
    process.env[FLAG] = "false";
    const res = await POST({ timezone: "UTC" });
    assert.equal(res.status, 404);
  });

  test("is reachable (marks reading) when the feature flag is enabled", async () => {
    sessionRow = makeRow({ primaryArticleId: "a1" });
    const res = await POST({ timezone: "UTC" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { updated: boolean; completionTier: string };
    assert.equal(body.updated, true);
    assert.equal(body.completionTier, "reading");
  });
});

// ---------------------------------------------------------------------------
// Dashboard Today card hides when the feature is disabled
// ---------------------------------------------------------------------------

describe("dashboard view model Today gating", () => {
  const user = { id: USER_ID, role: "Reader" as const };

  async function load() {
    const { loadDashboardViewModel } = await import(
      "@/app/(app)/dashboard/view-model"
    );
    return loadDashboardViewModel(user, null);
  }

  test("todaySummary is null (card hidden) and is never loaded when disabled", async () => {
    process.env[FLAG] = "false";
    const vm = await load();
    assert.equal(vm.todaySummary, null);
    assert.equal(
      todayViewModelCalls,
      0,
      "loadTodayViewModel must not run when the feature is off",
    );
  });

  test("todaySummary is populated (card shown) when enabled", async () => {
    process.env[FLAG] = "true";
    const vm = await load();
    assert.ok(vm.todaySummary, "todaySummary should be present when enabled");
    assert.equal(vm.todaySummary?.status, "active");
    assert.equal(todayViewModelCalls, 1);
  });
});
