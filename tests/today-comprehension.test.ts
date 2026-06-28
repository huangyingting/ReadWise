/**
 * Today comprehension feedback & quiz remediation (#807).
 *
 * Covers the lightweight self-check loop end-to-end against mocked prisma +
 * mastery + analytics seams:
 *   - self-rating ALONE completes comprehension (no full quiz required);
 *   - MCQ selection (most-recent question) + server-side correct/incorrect grading;
 *   - a wrong answer triggers the remediation step (remediationViewed + deep-link);
 *   - skillTag weakness signals feed the EXISTING mastery paths;
 *   - graceful degradation when the article has no QuizQuestion rows;
 *   - a mastery failure never breaks comprehension completion;
 *   - PRIVACY: the persisted row + the analytics payload carry ids/enums/booleans ONLY.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events/catalog";
import { type RouteHandler, jsonPost, getReq } from "./support/route";
import { type AuthState, sessionAuthExports } from "./support/auth-mock";

type Row = Record<string, unknown>;

const USER_ID = "user-1";
// Anchored to the current UTC day so the pre-seeded Today session matches the
// localDate the route/generator resolves from `new Date()` (avoids date-rollover
// flakiness). Format matches dateKey(now, "UTC").
const LOCAL_DATE = new Date().toISOString().slice(0, 10);
const NOW = new Date(`${LOCAL_DATE}T12:00:00Z`);
const CREATED_AT = new Date("2026-06-27T00:00:00Z");

// ---- mutable mock state ---------------------------------------------------

let authState: AuthState = "ok";
let sessionRow: Row | null = null;
let quizQuestions: Array<{
  id: string;
  articleId: string;
  question: string;
  options: string[];
  correctIndex: number;
}> = [];
let feedbackRows: Row[] = [];
let skillEvidence: Array<{ skill: string; outcome: number; weight: number }> = [];
let articleMasteryCalls: Array<{ userId: string; articleId: string }> = [];
let capturedEvents: Array<{ type: string; properties: Record<string, unknown> }> = [];
let masteryShouldThrow = false;

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
    completionTier: "reading",
    generationReasonCode: "picks_primary",
    readingCompletedAt: CREATED_AT,
    comprehensionCompletedAt: null,
    wordReviewCompletedAt: null,
    completedAt: null,
    skipped: false,
    skipReason: null,
    skippedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
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
        savedWord: { findMany: async () => [] },
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
        quizQuestion: {
          findFirst: async ({
            where,
            select,
          }: {
            where: { articleId: string; id?: string };
            select?: Record<string, boolean>;
          }) => {
            // Grading lookup: where { id, articleId } → correctIndex.
            if (where.id) {
              const q = quizQuestions.find(
                (qq) => qq.id === where.id && qq.articleId === where.articleId,
              );
              return q ? { correctIndex: q.correctIndex } : null;
            }
            // Selection lookup: most recently added question for the article.
            const matches = quizQuestions.filter((qq) => qq.articleId === where.articleId);
            if (matches.length === 0) return null;
            const q = matches[matches.length - 1];
            void select;
            return { id: q.id, question: q.question, options: q.options };
          },
        },
        todayComprehensionFeedback: {
          findFirst: async ({
            where,
          }: {
            where: { userId: string; todaySessionId: string };
          }) =>
            feedbackRows.find(
              (r) =>
                r.userId === where.userId && r.todaySessionId === where.todaySessionId,
            ) ?? null,
          create: async ({ data }: { data: Row }) => {
            const row = { id: `fb${feedbackRows.length + 1}`, ...data };
            feedbackRows.push(row);
            return row;
          },
          update: async ({ where, data }: { where: { id: string }; data: Row }) => {
            const row = feedbackRows.find((r) => r.id === where.id);
            if (row) Object.assign(row, data);
            return row;
          },
        },
      },
    },
  });

  mock.module("@/lib/learning/article-mastery", {
    namedExports: {
      updateArticleMastery: async (userId: string, articleId: string) => {
        if (masteryShouldThrow) throw new Error("mastery boom");
        articleMasteryCalls.push({ userId, articleId });
        return null;
      },
    },
  });

  mock.module("@/lib/learning/skill-mastery", {
    namedExports: {
      recordSkillEvidence: async (
        _userId: string,
        skill: string,
        outcome: number,
        weight = 1,
      ) => {
        if (masteryShouldThrow) throw new Error("skill boom");
        skillEvidence.push({ skill, outcome, weight });
        return null;
      },
    },
  });

  mock.module("@/lib/analytics/events", {
    namedExports: {
      ANALYTICS_EVENT_TYPES,
      recordEvent: async (input: {
        type: string;
        properties?: Record<string, unknown> | null;
      }) => {
        capturedEvents.push({ type: input.type, properties: input.properties ?? {} });
      },
    },
  });
});

beforeEach(() => {
  authState = "ok";
  sessionRow = null;
  quizQuestions = [];
  feedbackRows = [];
  skillEvidence = [];
  articleMasteryCalls = [];
  capturedEvents = [];
  masteryShouldThrow = false;
});

const importLib = () => import("@/lib/engagement/today-session/comprehension");

async function POST(body: unknown) {
  const { POST: handler } = (await import(
    "@/app/api/today/comprehension/route"
  )) as { POST: RouteHandler };
  return handler(jsonPost("http://localhost/api/today/comprehension", body));
}

async function GET(url = "http://localhost/api/today/comprehension") {
  const { GET: handler } = (await import(
    "@/app/api/today/comprehension/route"
  )) as { GET: RouteHandler };
  return handler(getReq(url));
}

// ===========================================================================
// Pure helpers
// ===========================================================================

test("comprehensionSkillForTag maps tags to tracked skills", async () => {
  const { comprehensionSkillForTag } = await importLib();
  assert.equal(comprehensionSkillForTag("main_idea"), "comprehension");
  assert.equal(comprehensionSkillForTag("detail"), "comprehension");
  assert.equal(comprehensionSkillForTag("inference"), "comprehension");
  assert.equal(comprehensionSkillForTag("vocabulary_in_context"), "vocabulary");
  assert.equal(comprehensionSkillForTag(null), "comprehension");
});

test("controlled-value validators reject free text", async () => {
  const { isComprehensionSelfRating, isComprehensionSkillTag } = await importLib();
  assert.equal(isComprehensionSelfRating("confident"), true);
  assert.equal(isComprehensionSelfRating("totally lost"), false);
  assert.equal(isComprehensionSkillTag("inference"), true);
  assert.equal(isComprehensionSkillTag("article body text"), false);
});

// ===========================================================================
// Self-rating completes comprehension without a full quiz
// ===========================================================================

test("self-rating alone completes comprehension (no MCQ, no quiz)", async () => {
  sessionRow = makeRow();
  const { submitTodayComprehension } = await importLib();
  const res = await submitTodayComprehension({
    userId: USER_ID,
    selfRating: "confident",
    now: NOW,
  });
  assert.ok(res);
  assert.equal(res.updated, true);
  assert.equal(res.mcqCorrect, null);
  assert.equal(res.remediation.show, false);
  // Comprehension step advanced on self-rating alone.
  assert.ok(sessionRow!.comprehensionCompletedAt instanceof Date);
  // One feedback row persisted, self-rating only.
  assert.equal(feedbackRows.length, 1);
  assert.equal(feedbackRows[0].selfRating, "confident");
  assert.equal(feedbackRows[0].questionId, null);
  assert.equal(feedbackRows[0].mcqCorrect, null);
  // Self-rating feeds comprehension skill evidence.
  assert.ok(skillEvidence.some((e) => e.skill === "comprehension"));
  assert.equal(articleMasteryCalls.length, 1);
});

test("returns null when there is no Today session / primary article", async () => {
  sessionRow = null;
  const { submitTodayComprehension } = await importLib();
  const res = await submitTodayComprehension({
    userId: USER_ID,
    selfRating: "partial",
    now: NOW,
  });
  assert.equal(res, null);

  sessionRow = makeRow({ primaryArticleId: null });
  const res2 = await submitTodayComprehension({
    userId: USER_ID,
    selfRating: "partial",
    now: NOW,
  });
  assert.equal(res2, null);
});

// ===========================================================================
// MCQ selection + grading
// ===========================================================================

test("selects the most recently added question (no correctIndex leaked)", async () => {
  sessionRow = makeRow();
  quizQuestions = [
    { id: "q1", articleId: "a1", question: "Old?", options: ["a", "b"], correctIndex: 0 },
    { id: "q2", articleId: "a1", question: "New?", options: ["x", "y"], correctIndex: 1 },
  ];
  const { selectTodayComprehensionQuestion } = await importLib();
  const q = await selectTodayComprehensionQuestion("a1");
  assert.ok(q);
  assert.equal(q.id, "q2");
  assert.deepEqual(q.options, ["x", "y"]);
  assert.equal((q as Record<string, unknown>).correctIndex, undefined);
});

test("correct MCQ answer grades server-side and records a strong signal", async () => {
  sessionRow = makeRow();
  quizQuestions = [
    { id: "q1", articleId: "a1", question: "Q?", options: ["a", "b", "c"], correctIndex: 2 },
  ];
  const { submitTodayComprehension } = await importLib();
  const res = await submitTodayComprehension({
    userId: USER_ID,
    selfRating: "confident",
    questionId: "q1",
    selectedIndex: 2,
    skillTag: "main_idea",
    now: NOW,
  });
  assert.ok(res);
  assert.equal(res.mcqCorrect, true);
  assert.equal(res.remediation.show, false);
  assert.equal(feedbackRows[0].mcqCorrect, true);
  assert.equal(feedbackRows[0].questionId, "q1");
  assert.equal(feedbackRows[0].skillTag, "main_idea");
  // main_idea → comprehension skill, outcome 1.
  assert.ok(skillEvidence.some((e) => e.skill === "comprehension" && e.outcome === 1));
});

test("vocabulary_in_context wrong answer triggers remediation + vocabulary signal", async () => {
  sessionRow = makeRow();
  quizQuestions = [
    { id: "q9", articleId: "a1", question: "Word?", options: ["a", "b"], correctIndex: 0 },
  ];
  const { submitTodayComprehension } = await importLib();
  const res = await submitTodayComprehension({
    userId: USER_ID,
    selfRating: "confused",
    questionId: "q9",
    selectedIndex: 1,
    skillTag: "vocabulary_in_context",
    now: NOW,
  });
  assert.ok(res);
  assert.equal(res.mcqCorrect, false);
  // Wrong answer → remediation step with a deep-link back to the article.
  assert.equal(res.remediation.show, true);
  assert.equal(res.remediation.articleHref, "/reader/a1");
  assert.equal(feedbackRows[0].remediationViewed, true);
  // vocabulary_in_context → vocabulary skill, outcome 0 (weakness signal).
  assert.ok(skillEvidence.some((e) => e.skill === "vocabulary" && e.outcome === 0));
});

test("a question id from another article is ignored (mcqCorrect stays null)", async () => {
  sessionRow = makeRow();
  quizQuestions = [
    { id: "qx", articleId: "other", question: "Q?", options: ["a"], correctIndex: 0 },
  ];
  const { submitTodayComprehension } = await importLib();
  const res = await submitTodayComprehension({
    userId: USER_ID,
    selfRating: "partial",
    questionId: "qx",
    selectedIndex: 0,
    now: NOW,
  });
  assert.ok(res);
  assert.equal(res.mcqCorrect, null);
  assert.equal(feedbackRows[0].questionId, null);
});

// ===========================================================================
// Graceful degradation + resilience
// ===========================================================================

test("degrades to self-rating only when the article has no quiz questions", async () => {
  sessionRow = makeRow();
  quizQuestions = [];
  const { loadTodayComprehensionCheck, submitTodayComprehension } = await importLib();

  const check = await loadTodayComprehensionCheck({ userId: USER_ID, now: NOW });
  assert.equal(check.available, true);
  assert.equal(check.question, null);
  assert.equal(check.articleId, "a1");

  const res = await submitTodayComprehension({
    userId: USER_ID,
    selfRating: "partial",
    now: NOW,
  });
  assert.ok(res);
  assert.equal(res.updated, true);
  assert.ok(sessionRow!.comprehensionCompletedAt instanceof Date);
});

test("a mastery failure never breaks comprehension completion", async () => {
  sessionRow = makeRow();
  masteryShouldThrow = true;
  const { submitTodayComprehension } = await importLib();
  const res = await submitTodayComprehension({
    userId: USER_ID,
    selfRating: "confident",
    now: NOW,
  });
  assert.ok(res);
  assert.equal(res.updated, true);
  assert.ok(sessionRow!.comprehensionCompletedAt instanceof Date);
});

// ===========================================================================
// Route surface
// ===========================================================================

test("route: 401 when unauthenticated", async () => {
  authState = "unauth";
  const res = await POST({ selfRating: "confident" });
  assert.equal(res.status, 401);
});

test("route: 400 on an invalid (free-text) self-rating", async () => {
  sessionRow = makeRow();
  const res = await POST({ selfRating: "totally lost" });
  assert.equal(res.status, 400);
});

test("route: POST completes comprehension and returns safe state", async () => {
  sessionRow = makeRow();
  const res = await POST({ selfRating: "confident" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { updated: boolean; mcqCorrect: unknown };
  assert.equal(body.updated, true);
  assert.equal(body.mcqCorrect, null);
});

test("route: GET returns the optional question without correctIndex", async () => {
  sessionRow = makeRow();
  quizQuestions = [
    { id: "q1", articleId: "a1", question: "Q?", options: ["a", "b"], correctIndex: 1 },
  ];
  const res = await GET();
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    available: boolean;
    question: { id: string; correctIndex?: number } | null;
  };
  assert.equal(body.available, true);
  assert.equal(body.question?.id, "q1");
  assert.equal(body.question?.correctIndex, undefined);
});

// ===========================================================================
// Privacy: persisted row + analytics payload carry ids/enums/booleans ONLY
// ===========================================================================

const ALLOWED_FEEDBACK_KEYS = new Set([
  "id",
  "userId",
  "todaySessionId",
  "articleId",
  "selfRating",
  "questionId",
  "mcqCorrect",
  "skillTag",
  "remediationViewed",
]);

const ALLOWED_SELF_RATINGS = new Set(["confident", "partial", "confused"]);
const ALLOWED_SKILL_TAGS = new Set([
  "main_idea",
  "detail",
  "inference",
  "vocabulary_in_context",
]);

test("privacy: persisted feedback row contains only ids/enums/booleans", async () => {
  sessionRow = makeRow();
  quizQuestions = [
    { id: "q1", articleId: "a1", question: "Secret question?", options: ["opt a", "opt b"], correctIndex: 0 },
  ];
  const { submitTodayComprehension } = await importLib();
  await submitTodayComprehension({
    userId: USER_ID,
    selfRating: "confused",
    questionId: "q1",
    selectedIndex: 1,
    skillTag: "inference",
    now: NOW,
  });

  assert.equal(feedbackRows.length, 1);
  const row = feedbackRows[0];
  for (const key of Object.keys(row)) {
    assert.ok(ALLOWED_FEEDBACK_KEYS.has(key), `unexpected persisted key: ${key}`);
  }
  // No question/option text leaked into the row.
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes("Secret question"));
  assert.ok(!serialized.includes("opt a"));
  // Controlled enums only.
  assert.ok(ALLOWED_SELF_RATINGS.has(row.selfRating as string));
  assert.ok(ALLOWED_SKILL_TAGS.has(row.skillTag as string));
  assert.equal(typeof row.mcqCorrect, "boolean");
  assert.equal(typeof row.remediationViewed, "boolean");
});

test("privacy: today_comprehension_submitted analytics payload is enums/booleans only", async () => {
  sessionRow = makeRow();
  quizQuestions = [
    { id: "q1", articleId: "a1", question: "Hidden?", options: ["x", "y"], correctIndex: 0 },
  ];
  const { submitTodayComprehension } = await importLib();
  await submitTodayComprehension({
    userId: USER_ID,
    selfRating: "partial",
    questionId: "q1",
    selectedIndex: 1,
    skillTag: "detail",
    now: NOW,
  });

  const event = capturedEvents.find(
    (e) => e.type === "today_comprehension_submitted",
  );
  assert.ok(event, "expected a today_comprehension_submitted event");
  assert.deepEqual(Object.keys(event!.properties).sort(), [
    "mcqCorrect",
    "remediationViewed",
    "selfRating",
    "skillTag",
  ]);
  assert.ok(ALLOWED_SELF_RATINGS.has(event!.properties.selfRating as string));
  assert.ok(ALLOWED_SKILL_TAGS.has(event!.properties.skillTag as string));
  assert.equal(typeof event!.properties.mcqCorrect, "boolean");
  assert.equal(typeof event!.properties.remediationViewed, "boolean");
  // No raw question/option text anywhere in the payload.
  const serialized = JSON.stringify(event!.properties);
  assert.ok(!serialized.includes("Hidden"));
  assert.ok(!serialized.includes("x"));
});

// ===========================================================================
// exportUserData includes the controlled feedback fields
// ===========================================================================

test("exportUserData selects only controlled TodayComprehensionFeedback fields", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(
    new URL("../src/lib/account-lifecycle/account-commands.ts", import.meta.url),
    "utf8",
  );
  const idx = src.indexOf("todayComprehensionFeedback:");
  assert.ok(idx > 0, "exportUserData must select todayComprehensionFeedback");
  const block = src.slice(idx, idx + 400);
  for (const field of [
    "todaySessionId",
    "articleId",
    "selfRating",
    "questionId",
    "mcqCorrect",
    "skillTag",
    "remediationViewed",
  ]) {
    assert.ok(block.includes(field), `export must include ${field}`);
  }
  // Must NOT export any question/answer/article text fields.
  for (const banned of ["question:", "options:", "explanation", "content"]) {
    assert.ok(!block.includes(banned), `export must not include ${banned}`);
  }
});
