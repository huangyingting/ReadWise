import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let aiConfigured = false;
let aiReply: string | null = null;
const articles = new Map<string, { title: string; content: string }>();
let vocabRows: { word: string; explanation: string; example: string }[] = [];
let savedRows: { word: string }[] = [];
let vocabUpserts = 0;
let lastSaveUpsert: unknown = null;
let lastContextErase: unknown = null;

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
          updateMany: async (a: unknown) => {
            lastContextErase = a;
            return { count: 1 };
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
  lastContextErase = null;
  articles.set("a1", { title: "Title", content: "<p>Hard vocabulary words</p>" });
});

async function importVocabulary() {
  return import("@/lib/vocabulary");
}

async function importSavedWords() {
  return import("@/lib/lexical/saved-words");
}

test("returns cached vocabulary with per-user saved flags", async () => {
  vocabRows = [
    { word: "ephemeral", explanation: "short-lived", example: "An ephemeral fad." },
    { word: "Robust", explanation: "strong", example: "A robust system." },
  ];
  savedRows = [{ word: "ROBUST" }];
  const { getOrCreateArticleVocabulary } = await importVocabulary();
  const result = await getOrCreateArticleVocabulary("a1", "user-1");
  assert.equal(result?.fallback, false);
  assert.equal(result?.items.length, 2);
  const robust = result?.items.find((i) => i.word === "Robust");
  assert.equal(robust?.saved, true);
  assert.equal(result?.items.find((i) => i.word === "ephemeral")?.saved, false);
  assert.equal(vocabUpserts, 0);
});

test("returns null for a missing article", async () => {
  const { getOrCreateArticleVocabulary } = await importVocabulary();
  assert.equal(await getOrCreateArticleVocabulary("missing", "u"), null);
});

test("falls back without caching when AI is unconfigured", async () => {
  const { getOrCreateArticleVocabulary } = await importVocabulary();
  const result = await getOrCreateArticleVocabulary("a1", "u");
  assert.equal(result?.fallback, true);
  assert.equal(result?.fallbackReason, "provider_unconfigured");
  assert.equal(result?.items.length, 0);
  assert.equal(vocabUpserts, 0);
});

test("returns validation fallback reason for unusable AI vocabulary output", async () => {
  aiConfigured = true;
  aiReply = "not json at all";
  const { getOrCreateArticleVocabulary } = await importVocabulary();
  const result = await getOrCreateArticleVocabulary("a1", "u");
  assert.equal(result?.fallback, true);
  assert.equal(result?.fallbackReason, "validation_failed");
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
  const { getOrCreateArticleVocabulary } = await importVocabulary();
  const result = await getOrCreateArticleVocabulary("a1", "u");
  assert.equal(result?.fallback, false);
  assert.equal(result?.items.length, 1);
  assert.equal(result?.items[0].word, "Lucid");
  assert.equal(vocabUpserts, 1);
});

test("saveWord upserts a trimmed word for the user", async () => {
  const { saveWord } = await importSavedWords();
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
  const { saveWord } = await importSavedWords();
  await saveWord("user-1", { word: "   " });
  assert.equal(lastSaveUpsert, null);
});

test("clearSavedWordContextSentence nulls only context for a trimmed saved word", async () => {
  const { clearSavedWordContextSentence } = await importSavedWords();
  const count = await clearSavedWordContextSentence("user-1", "  curious  ");
  const args = lastContextErase as {
    where: { userId: string; word: string };
    data: { contextSentence: string | null };
  };

  assert.equal(count, 1);
  assert.deepEqual(args.where, { userId: "user-1", word: "curious" });
  assert.deepEqual(args.data, { contextSentence: null });
});

test("clearSavedWordContextSentence is a no-op for a blank word", async () => {
  const { clearSavedWordContextSentence } = await importSavedWords();
  const count = await clearSavedWordContextSentence("user-1", "   ");

  assert.equal(count, 0);
  assert.equal(lastContextErase, null);
});
