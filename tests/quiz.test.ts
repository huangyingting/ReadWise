import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let aiConfigured = false;
let aiReply: string | null = null;
const articles = new Map<string, { title: string; content: string }>();
type QuizRow = {
  id?: string;
  question: string;
  options: string | string[];
  correctIndex: number;
  skillTag?: string;
  standardCode?: string | null;
  explanation?: string | null;
};
let quizRows: QuizRow[] = [];
let quizUpserts = 0;

before(() => {
  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => aiConfigured,
      aiModelName: () => (aiConfigured ? "gpt-test" : null),
      chatComplete: async () => aiReply,
    },
  });
  mock.module("@/lib/ai/facade", {
    namedExports: {
      isAiConfigured: () => aiConfigured,
      aiModelName: () => (aiConfigured ? "gpt-test" : null),
      chatComplete: async () => aiReply,
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findUnique: async (a: { where: { id: string } }) =>
            articles.get(a.where.id) ?? null,
        },
        quizQuestion: {
          findMany: async () => quizRows,
          upsert: async (a: { create: QuizRow }) => {
            quizUpserts++;
            const row = { id: `q-${quizUpserts}`, ...a.create };
            quizRows.push(row);
            return row;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  aiConfigured = false;
  aiReply = null;
  articles.clear();
  quizRows = [];
  quizUpserts = 0;
  articles.set("a1", { title: "Title", content: "<p>Some article body text.</p>" });
});

test("validateQuiz validates options and correctIndex", async () => {
  const { validateQuiz } = await import("@/lib/ai/output/validators");
  const ok = validateQuiz(
    '[{"question":"Q1?","options":["a","b","c"],"correctIndex":1}]',
  ).items;
  assert.equal(ok.length, 1);
  assert.equal(ok[0].correctIndex, 1);

  // fewer than 2 options / out-of-range index are dropped
  assert.equal(
    validateQuiz('[{"question":"Q","options":["only"],"correctIndex":0}]').items.length,
    0,
  );
  assert.equal(
    validateQuiz('[{"question":"Q","options":["a","b"],"correctIndex":5}]').items.length,
    0,
  );
  assert.equal(validateQuiz("not json at all").items.length, 0);
});

test("getOrCreateArticleQuiz returns cached questions, parsing stored options", async () => {
  quizRows = [{ question: "Q?", options: ["a", "b"], correctIndex: 0 }];
  const { getOrCreateArticleQuiz } = await import("@/lib/quiz");
  const result = await getOrCreateArticleQuiz("a1");
  assert.equal(result?.fallback, false);
  assert.deepEqual(result?.questions[0].options, ["a", "b"]);
  assert.equal(quizUpserts, 0);
});

test("parseStoredOptions supports empty and Json array shapes", async () => {
  const { parseStoredOptions } = await import("@/lib/quiz");
  assert.deepEqual(parseStoredOptions([]), []);
  assert.deepEqual(parseStoredOptions(["a", "b"]), ["a", "b"]);
  assert.deepEqual(parseStoredOptions(["a", 1, "b"]), ["a", "b"]);
  assert.deepEqual(parseStoredOptions(null), []);
});

test("getOrCreateArticleQuiz parses native Json array options", async () => {
  quizRows = [{ question: "Q?", options: ["a", "b"], correctIndex: 0 }];
  const { getOrCreateArticleQuiz } = await import("@/lib/quiz");
  const result = await getOrCreateArticleQuiz("a1");
  assert.deepEqual(result?.questions[0].options, ["a", "b"]);
  assert.equal(quizUpserts, 0);
});

test("getOrCreateArticleQuiz returns null for a missing article", async () => {
  const { getOrCreateArticleQuiz } = await import("@/lib/quiz");
  assert.equal(await getOrCreateArticleQuiz("missing"), null);
});

test("getOrCreateArticleQuiz falls back without caching when AI unconfigured", async () => {
  const { getOrCreateArticleQuiz } = await import("@/lib/quiz");
  const result = await getOrCreateArticleQuiz("a1");
  assert.equal(result?.fallback, true);
  assert.equal(result?.fallbackReason, "provider_unconfigured");
  assert.equal(quizUpserts, 0);
});

test("getOrCreateArticleQuiz records validation fallback reason for unusable AI output", async () => {
  aiConfigured = true;
  aiReply = "not json at all";
  const { getOrCreateArticleQuiz } = await import("@/lib/quiz");
  const result = await getOrCreateArticleQuiz("a1");
  assert.equal(result?.fallback, true);
  assert.equal(result?.fallbackReason, "validation_failed");
  assert.equal(quizUpserts, 0);
});

test("getOrCreateArticleQuiz generates + caches when AI configured", async () => {
  aiConfigured = true;
  aiReply = '[{"question":"What?","options":["x","y","z"],"correctIndex":2}]';
  const { getOrCreateArticleQuiz } = await import("@/lib/quiz");
  const result = await getOrCreateArticleQuiz("a1");
  assert.equal(result?.fallback, false);
  assert.equal(result?.questions.length, 1);
  assert.equal(result?.questions[0].correctIndex, 2);
  assert.deepEqual(quizRows[0].options, ["x", "y", "z"]);
  assert.equal(quizUpserts, 1);
});

test("validateQuiz keeps the model's skill and explanation, classifying when absent (#1302)", async () => {
  const { validateQuiz } = await import("@/lib/ai/output/validators");
  const items = validateQuiz(
    JSON.stringify([
      { question: "What is the main idea?", options: ["a", "b"], correctIndex: 0, skill: "R.4", explanation: "  Because.  " },
      { question: "Why did the dam fail?", options: ["a", "b"], correctIndex: 1 },
      { question: "Which word means big?", options: ["a", "b"], correctIndex: 1, skillTag: "argument", explanation: "x".repeat(700) },
    ]),
  ).items;
  assert.equal(items[0]?.skillTag, "vocabulary_in_context", "a recognized model skill wins over wording");
  assert.equal(items[0]?.explanation, "Because.");
  assert.equal(items[1]?.skillTag, "cause_effect");
  assert.equal(items[1]?.explanation, null);
  assert.equal(items[2]?.skillTag, "argument");
  assert.equal(items[2]?.explanation?.length, 600);
});

test("cached questions carry id, skill, standard, and explanation; legacy tags are reclassified (#1302)", async () => {
  quizRows = [
    { id: "q1", question: "What is the main idea?", options: ["a", "b"], correctIndex: 0, skillTag: "main_idea", explanation: "It sums up." },
    { id: "q2", question: "Why did it rain?", options: ["a", "b"], correctIndex: 1, skillTag: "legacy", explanation: null },
  ];
  const { getOrCreateArticleQuiz } = await import("@/lib/quiz");
  const result = await getOrCreateArticleQuiz("a1");
  assert.deepEqual(
    result?.questions.map((q) => [q.id, q.skillTag, q.standardCode, q.explanation]),
    [
      ["q1", "main_idea", "CCRA.R.2", "It sums up."],
      ["q2", "cause_effect", "CCRA.R.3", null],
    ],
  );
});

test("generated questions are stored with skill, standard, and explanation (#1302)", async () => {
  aiConfigured = true;
  aiReply = '[{"question":"What does scarce mean?","options":["rare","many"],"correctIndex":0,"explanation":"Scarce means rare."}]';
  const { getOrCreateArticleQuiz } = await import("@/lib/quiz");
  const result = await getOrCreateArticleQuiz("a1");
  assert.equal(quizRows[0]?.skillTag, "vocabulary_in_context");
  assert.equal(quizRows[0]?.standardCode, "CCRA.R.4");
  assert.equal(quizRows[0]?.explanation, "Scarce means rare.");
  assert.equal(result?.questions[0]?.id, "q-1");
  assert.equal(result?.questions[0]?.standardCode, "CCRA.R.4");
});
