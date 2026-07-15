process.env.LOG_LEVEL = "error";
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// Mutable test state the module mocks read from.
let aiConfigured = false;
let aiReply: string | null = null;

type CacheRow = { translation: string };
const cache = new Map<string, CacheRow>(); // key: "articleId|sourceHash|lang"
const articles = new Map<string, { id: string }>();
let createCalls = 0;

async function sourceHash(text: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function seedTranslation(articleId: string, sourceText: string, targetLang: string, translation: string) {
  cache.set(`${articleId}|${await sourceHash(sourceText)}|${targetLang}`, { translation });
}

async function translateDefault(text = "Hello world") {
  const { translateSentence } = await import("@/lib/sentence-translation");
  return translateSentence("a1", text, "es");
}

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
        sentenceTranslation: {
          findUnique: async (args: {
            where: {
              articleId_sourceHash_targetLang: {
                articleId: string;
                sourceHash: string;
                targetLang: string;
              };
            };
          }) => {
            const { articleId, sourceHash, targetLang } =
              args.where.articleId_sourceHash_targetLang;
            return cache.get(`${articleId}|${sourceHash}|${targetLang}`) ?? null;
          },
          create: async (args: {
            data: {
              articleId: string;
              sourceHash: string;
              targetLang: string;
              translation: string;
            };
          }) => {
            createCalls++;
            const { articleId, sourceHash, targetLang, translation } = args.data;
            const row = { translation };
            cache.set(`${articleId}|${sourceHash}|${targetLang}`, row);
            return row;
          },
        },
        article: {
          findUnique: async (args: { where: { id: string } }) =>
            articles.get(args.where.id) ?? null,
        },
      },
    },
  });
});

beforeEach(() => {
  aiConfigured = false;
  aiReply = null;
  cache.clear();
  articles.clear();
  createCalls = 0;
  articles.set("a1", { id: "a1" });
});

test("cache miss → AI generates and persists translation", async () => {
  aiConfigured = true;
  aiReply = "Hola mundo";
  const result = await translateDefault();
  assert.ok(result);
  assert.equal(result.fallback, false);
  assert.equal(result.translation, "Hola mundo");
  assert.equal(createCalls, 1);
});

test("cache hit → returns cached translation without calling AI", async () => {
  aiConfigured = true;
  aiReply = "should not be used";
  await seedTranslation("a1", "Hello world", "es", "Cached translation");

  const result = await translateDefault();
  assert.ok(result);
  assert.equal(result.fallback, false);
  assert.equal(result.translation, "Cached translation");
  assert.equal(createCalls, 0);
});

test("article not found → returns null", async () => {
  const { translateSentence } = await import("@/lib/sentence-translation");
  const result = await translateSentence("nonexistent", "Hello world", "es");
  assert.equal(result, null);
  assert.equal(createCalls, 0);
});

test("AI unconfigured → fallback:true, nothing cached", async () => {
  aiConfigured = false;
  const result = await translateDefault();
  assert.ok(result);
  assert.equal(result.fallback, true);
  assert.equal(result.translation, null);
  assert.equal(createCalls, 0);
});

test("AI configured but request fails → fallback:true, nothing cached", async () => {
  aiConfigured = true;
  aiReply = null; // simulate network/AI failure
  const result = await translateDefault();
  assert.ok(result);
  assert.equal(result.fallback, true);
  assert.equal(result.translation, null);
  assert.equal(createCalls, 0);
});

test("whitespace-normalized text shares a cache entry", async () => {
  aiConfigured = true;
  aiReply = "Hola mundo";
  const { translateSentence } = await import("@/lib/sentence-translation");

  // First call with leading/trailing spaces and extra internal whitespace.
  const r1 = await translateSentence("a1", "  Hello   world  ", "es");
  assert.equal(r1?.translation, "Hola mundo");
  assert.equal(createCalls, 1);

  // Second call with a different representation of the same normalized text.
  aiReply = "should not be called again";
  const r2 = await translateSentence("a1", "Hello world", "es");
  assert.equal(r2?.translation, "Hola mundo");
  assert.equal(createCalls, 1); // still just one DB write
});
