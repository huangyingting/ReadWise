import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let aiConfigured = false;
let aiReply: string | null = null;
const articles = new Map<string, { title: string; content: string }>();
let quizRows: { question: string; options: string | string[]; correctIndex: number }[] = [];
let quizUpserts = 0;

before(() => {
  mock.module("@/lib/ai", {
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
          upsert: async (a: {
            create: { question: string; options: string[]; correctIndex: number };
          }) => {
            quizUpserts++;
            quizRows.push(a.create);
            return a.create;
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

test("parseQuizJson validates options and correctIndex", async () => {
  const { parseQuizJson } = await import("@/lib/quiz");
  const ok = parseQuizJson(
    '[{"question":"Q1?","options":["a","b","c"],"correctIndex":1}]',
  );
  assert.equal(ok.length, 1);
  assert.equal(ok[0].correctIndex, 1);

  // fewer than 2 options / out-of-range index are dropped
  assert.equal(
    parseQuizJson('[{"question":"Q","options":["only"],"correctIndex":0}]').length,
    0,
  );
  assert.equal(
    parseQuizJson('[{"question":"Q","options":["a","b"],"correctIndex":5}]').length,
    0,
  );
  assert.equal(parseQuizJson("not json at all").length, 0);
});

test("getOrCreateArticleQuiz returns cached questions, parsing stored options", async () => {
  quizRows = [{ question: "Q?", options: ["a", "b"], correctIndex: 0 }];
  const { getOrCreateArticleQuiz } = await import("@/lib/quiz");
  const result = await getOrCreateArticleQuiz("a1");
  assert.equal(result?.fallback, false);
  assert.deepEqual(result?.questions[0].options, ["a", "b"]);
  assert.equal(quizUpserts, 0);
});

test("parseStoredOptions supports empty, Json, and legacy string shapes", async () => {
  const { parseStoredOptions } = await import("@/lib/quiz");
  assert.deepEqual(parseStoredOptions([]), []);
  assert.deepEqual(parseStoredOptions(["a", "b"]), ["a", "b"]);
  assert.deepEqual(parseStoredOptions(["a", 1, "b"]), ["a", "b"]);
  assert.deepEqual(parseStoredOptions(JSON.stringify(["legacy", "row"])), [
    "legacy",
    "row",
  ]);
  assert.deepEqual(parseStoredOptions("not json"), []);
});

test("getOrCreateArticleQuiz remains compatible with legacy string rows", async () => {
  quizRows = [{ question: "Q?", options: JSON.stringify(["a", "b"]), correctIndex: 0 }];
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
