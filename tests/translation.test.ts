import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// Mutable test state the module mocks read from.
let aiConfigured = false;
let aiReply: string | null = null;
const translations = new Map<string, { content: string; model: string | null }>();
const articles = new Map<string, { title: string; content: string }>();
let upsertCalls = 0;
type ChatMessage = { role: string; content: string };
let chatCalls: ChatMessage[][] = [];
// Per-test override; defaults to returning the fixed `aiReply`.
let chatImpl: (messages: ChatMessage[]) => string | null = () => aiReply;

before(() => {
  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => aiConfigured,
      aiModelName: () => (aiConfigured ? "gpt-test" : null),
      chatComplete: async (messages: ChatMessage[]) => {
        chatCalls.push(messages);
        return chatImpl(messages);
      },
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
  chatCalls = [];
  chatImpl = () => aiReply;
  articles.set("a1", { title: "Title", content: "<p>Hello world</p>" });
});

test("htmlToPlainText / language helpers", async () => {
  const { articleHtmlToReaderText, isSupportedLanguage, languageLabel } = await import(
    "@/lib/translation"
  );
  assert.equal(articleHtmlToReaderText("<p>Hello</p><p>World</p>"), "Hello World");
  assert.equal(
    articleHtmlToReaderText('<p>Read <a href="https://example.com/path">the source</a>.</p>'),
    "Read the source.",
  );
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

test("long articles are translated in multiple chunks covering the full text", async () => {
  // Build an article large enough to exceed the translation chunk budget so the
  // helper must split it (RW-025). Each sentence is uniquely identifiable.
  const sentences: string[] = [];
  for (let i = 0; i < 400; i++) {
    sentences.push(`Sentence number ${i} carries unique filler content for coverage.`);
  }
  articles.set("long", { title: "Long", content: `<p>${sentences.join(" ")}</p>` });

  aiConfigured = true;
  // Echo each chunk's source text, tagged, so we can prove every chunk was sent
  // and that the persisted translation concatenates them all.
  chatImpl = (messages) => {
    const userMsg = messages.find((m) => m.role === "user");
    return `[T]${userMsg?.content ?? ""}`;
  };

  const { getOrCreateTranslation } = await import("@/lib/translation");
  const result = await getOrCreateTranslation("long", "es");

  assert.equal(result?.fallback, false);
  assert.equal(result?.cached, false);
  assert.ok(chatCalls.length > 1, "long article should require multiple chunk calls");
  assert.equal(upsertCalls, 1, "the full translation is persisted exactly once");

  // Every sentence index appears somewhere in the combined translation output.
  const combined = result?.content ?? "";
  for (let i = 0; i < 400; i++) {
    assert.ok(combined.includes(`Sentence number ${i} `), `missing translated sentence ${i}`);
  }
});

test("a single failed chunk degrades to fallback and caches nothing", async () => {
  const sentences: string[] = [];
  for (let i = 0; i < 400; i++) {
    sentences.push(`Sentence number ${i} carries unique filler content for coverage.`);
  }
  articles.set("long", { title: "Long", content: `<p>${sentences.join(" ")}</p>` });

  aiConfigured = true;
  let call = 0;
  chatImpl = () => {
    call++;
    // Fail the 2nd chunk only.
    return call === 2 ? null : "translated part";
  };

  const { getOrCreateTranslation } = await import("@/lib/translation");
  const result = await getOrCreateTranslation("long", "es");

  assert.equal(result?.fallback, true);
  assert.equal(upsertCalls, 0, "a partial translation must never be cached");
  assert.equal(translations.has("long|es"), false);
});

test("repeated requests reuse the cache (no second AI call)", async () => {
  aiConfigured = true;
  aiReply = "Hola";
  const { getOrCreateTranslation } = await import("@/lib/translation");

  const first = await getOrCreateTranslation("a1", "es");
  assert.equal(first?.cached, false);
  assert.equal(upsertCalls, 1);
  const callsAfterFirst = chatCalls.length;

  const second = await getOrCreateTranslation("a1", "es");
  assert.equal(second?.cached, true);
  assert.equal(upsertCalls, 1, "no new persist on a cache hit");
  assert.equal(chatCalls.length, callsAfterFirst, "no new AI call on a cache hit");
});
