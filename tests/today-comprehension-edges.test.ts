process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let session: Record<string, unknown> | null = null;
let feedbackExisting: Record<string, unknown> | null = null;
let markView: Record<string, unknown> | null = null;
let updates: unknown[] = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        quizQuestion: {
          findFirst: async (query: { select?: Record<string, unknown> }) => {
            if (query.select?.correctIndex) return { correctIndex: 1 };
            return { id: "q1", question: "Question?", options: { not: "an array" } };
          },
        },
        todayComprehensionFeedback: {
          findFirst: async () => feedbackExisting,
          update: async (input: unknown) => updates.push(input),
          create: async (input: unknown) => updates.push(input),
        },
      },
    },
  });
  mock.module("@/lib/learning/primitives", {
    namedExports: { bestEffortMastery: async (_name: string, fn: () => unknown) => fn() },
  });
  mock.module("@/lib/learning/article-mastery", {
    namedExports: { updateArticleMastery: async () => {} },
  });
  mock.module("@/lib/learning/skill-mastery", {
    namedExports: { recordSkillEvidence: async () => {} },
  });
  mock.module("@/lib/engagement/today-session/repository", {
    namedExports: { getTodaySession: async () => session },
  });
  mock.module("@/lib/engagement/today-session/local-date", {
    namedExports: { resolveLocalDate: async () => ({ localDate: "2026-07-01", timezone: "UTC" }) },
  });
  mock.module("@/lib/engagement/today-session/completion", {
    namedExports: { markTodayComprehensionComplete: async () => markView },
  });
  mock.module("@/lib/engagement/today-session/analytics", {
    namedExports: { emitTodayComprehensionSubmitted: async () => {} },
  });
});

beforeEach(() => {
  session = null;
  feedbackExisting = null;
  markView = null;
  updates = [];
});

test("selectTodayComprehensionQuestion drops non-array option payloads", async () => {
  const { selectTodayComprehensionQuestion } = await import("@/lib/engagement/today-session/comprehension");

  assert.deepEqual(await selectTodayComprehensionQuestion("article-1"), {
    id: "q1",
    question: "Question?",
    options: [],
  });
});

test("loadTodayComprehensionCheck reports unavailable without an active primary article", async () => {
  const { loadTodayComprehensionCheck } = await import("@/lib/engagement/today-session/comprehension");

  assert.deepEqual(await loadTodayComprehensionCheck({ userId: "user-1" }), {
    available: false,
    articleId: null,
    question: null,
    completed: false,
    alreadySubmitted: false,
  });
});

test("submitTodayComprehension updates existing feedback and returns remediation when view is absent", async () => {
  const { submitTodayComprehension } = await import("@/lib/engagement/today-session/comprehension");
  session = { id: "today-1", primaryArticleId: "article-1" };
  feedbackExisting = { id: "feedback-1", remediationViewed: false };
  markView = null;

  const result = await submitTodayComprehension({
    userId: "user-1",
    selfRating: "partial",
    questionId: "q1",
    selectedIndex: 0,
    skillTag: "vocabulary_in_context",
  });

  assert.equal(result?.updated, false);
  assert.equal(result?.mcqCorrect, false);
  assert.deepEqual(result?.remediation, { show: true, articleHref: "/reader/article-1" });
  assert.equal(updates.length, 1);
  assert.equal((updates[0] as { where: { id: string } }).where.id, "feedback-1");
});
