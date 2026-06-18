import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let aiConfigured = false;
let aiReply: string | null = null;
const articles = new Map<string, { title: string; content: string }>();
let vocabRows: { word: string; explanation: string; example: string }[] = [];
let savedRows: { word: string }[] = [];
let vocabUpserts = 0;
let lastSaveUpsert: unknown = null;

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
        vocabularyItem: {
          findMany: async () => vocabRows,
          upsert: async (a: { create: { word: string; explanation: string; example: string } }) => {
            vocabUpserts++;
            vocabRows.push(a.create);
            return a.create;
          },
        },
        savedWord: {
          findMany: async () => savedRows,
          upsert: async (a: unknown) => {
            lastSaveUpsert = a;
            return {};
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
  vocabRows = [];
  savedRows = [];
  vocabUpserts = 0;
  lastSaveUpsert = null;
  articles.set("a1", { title: "Title", content: "<p>Hard vocabulary words</p>" });
});

test("returns cached vocabulary with per-user saved flags", async () => {
  vocabRows = [
    { word: "ephemeral", explanation: "short-lived", example: "An ephemeral fad." },
    { word: "Robust", explanation: "strong", example: "A robust system." },
  ];
  savedRows = [{ word: "ROBUST" }];
  const { getOrCreateArticleVocabulary } = await import("@/lib/vocabulary");
  const result = await getOrCreateArticleVocabulary("a1", "user-1");
  assert.equal(result?.fallback, false);
  assert.equal(result?.items.length, 2);
  const robust = result?.items.find((i) => i.word === "Robust");
  assert.equal(robust?.saved, true);
  assert.equal(result?.items.find((i) => i.word === "ephemeral")?.saved, false);
  assert.equal(vocabUpserts, 0);
});

test("returns null for a missing article", async () => {
  const { getOrCreateArticleVocabulary } = await import("@/lib/vocabulary");
  assert.equal(await getOrCreateArticleVocabulary("missing", "u"), null);
});

test("falls back without caching when AI is unconfigured", async () => {
  const { getOrCreateArticleVocabulary } = await import("@/lib/vocabulary");
  const result = await getOrCreateArticleVocabulary("a1", "u");
  assert.equal(result?.fallback, true);
  assert.equal(result?.items.length, 0);
  assert.equal(vocabUpserts, 0);
});

test("parses fenced JSON from the model, dedups, and caches", async () => {
  aiConfigured = true;
  aiReply =
    "```json\n[" +
    '{"word":"Lucid","explanation":"clear","example":"A lucid talk."},' +
    '{"word":"lucid","explanation":"dup","example":"dup."},' +
    '{"word":"","explanation":"x","example":"y"}' +
    "]\n```";
  const { getOrCreateArticleVocabulary } = await import("@/lib/vocabulary");
  const result = await getOrCreateArticleVocabulary("a1", "u");
  assert.equal(result?.fallback, false);
  assert.equal(result?.items.length, 1);
  assert.equal(result?.items[0].word, "Lucid");
  assert.equal(vocabUpserts, 1);
});

test("saveWord upserts a trimmed word for the user", async () => {
  const { saveWord } = await import("@/lib/vocabulary");
  await saveWord("user-1", { word: "  curious  ", explanation: "eager" });
  const args = lastSaveUpsert as {
    where: { userId_word: { userId: string; word: string } };
    create: { word: string };
  };
  assert.equal(args.where.userId_word.userId, "user-1");
  assert.equal(args.where.userId_word.word, "curious");
  assert.equal(args.create.word, "curious");
});

test("saveWord is a no-op for a blank word", async () => {
  const { saveWord } = await import("@/lib/vocabulary");
  await saveWord("user-1", { word: "   " });
  assert.equal(lastSaveUpsert, null);
});
