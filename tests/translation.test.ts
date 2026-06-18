import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// Mutable test state the module mocks read from.
let aiConfigured = false;
let aiReply: string | null = null;
const translations = new Map<string, { content: string; model: string | null }>();
const articles = new Map<string, { title: string; content: string }>();
let upsertCalls = 0;

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
        translation: {
          findUnique: async (args: {
            where: { articleId_targetLang: { articleId: string; targetLang: string } };
          }) => {
            const { articleId, targetLang } = args.where.articleId_targetLang;
            return translations.get(`${articleId}|${targetLang}`) ?? null;
          },
          upsert: async (args: {
            where: { articleId_targetLang: { articleId: string; targetLang: string } };
            create: { content: string; model: string | null };
          }) => {
            upsertCalls++;
            const { articleId, targetLang } = args.where.articleId_targetLang;
            const row = { content: args.create.content, model: args.create.model };
            translations.set(`${articleId}|${targetLang}`, row);
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
  translations.clear();
  articles.clear();
  upsertCalls = 0;
  articles.set("a1", { title: "Title", content: "<p>Hello world</p>" });
});

test("htmlToPlainText / language helpers", async () => {
  const { htmlToPlainText, isSupportedLanguage, languageLabel } = await import(
    "@/lib/translation"
  );
  assert.equal(htmlToPlainText("<p>Hello</p><p>World</p>"), "Hello\n\nWorld");
  assert.equal(isSupportedLanguage("es"), true);
  assert.equal(isSupportedLanguage("zz"), false);
  assert.equal(languageLabel("es"), "Spanish");
});

test("returns a cache hit without calling AI", async () => {
  translations.set("a1|es", { content: "Hola mundo", model: "x" });
  const { getOrCreateTranslation } = await import("@/lib/translation");
  const result = await getOrCreateTranslation("a1", "es");
  assert.equal(result?.cached, true);
  assert.equal(result?.fallback, false);
  assert.equal(result?.content, "Hola mundo");
  assert.equal(upsertCalls, 0);
});

test("returns null for a missing article", async () => {
  const { getOrCreateTranslation } = await import("@/lib/translation");
  assert.equal(await getOrCreateTranslation("missing", "es"), null);
});

test("falls back (no cache write) when AI is unconfigured", async () => {
  aiConfigured = false;
  const { getOrCreateTranslation } = await import("@/lib/translation");
  const result = await getOrCreateTranslation("a1", "es");
  assert.equal(result?.fallback, true);
  assert.equal(upsertCalls, 0);
  assert.equal(translations.has("a1|es"), false);
});

test("generates and caches a translation when AI is configured", async () => {
  aiConfigured = true;
  aiReply = "Hola mundo traducido";
  const { getOrCreateTranslation } = await import("@/lib/translation");
  const result = await getOrCreateTranslation("a1", "es");
  assert.equal(result?.fallback, false);
  assert.equal(result?.cached, false);
  assert.equal(result?.content, "Hola mundo traducido");
  assert.equal(upsertCalls, 1);
  assert.equal(translations.get("a1|es")?.content, "Hola mundo traducido");
});

test("falls back when AI is configured but the request fails", async () => {
  aiConfigured = true;
  aiReply = null;
  const { getOrCreateTranslation } = await import("@/lib/translation");
  const result = await getOrCreateTranslation("a1", "es");
  assert.equal(result?.fallback, true);
  assert.equal(upsertCalls, 0);
});
