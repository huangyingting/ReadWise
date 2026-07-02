process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let configured = true;
let defaultArticle: { title: string; content: string } | null = {
  title: "Article",
  content: "Body",
};
let chatCalls: Array<{ messages: unknown[]; options: Record<string, unknown> }> = [];
let chatResult: string | null = "model-output";

before(() => {
  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => configured,
      chatComplete: async (messages: unknown[], options: Record<string, unknown>) => {
        chatCalls.push({ messages, options });
        return chatResult;
      },
    },
  });
  mock.module("@/lib/ai/chunking", {
    namedExports: {
      promptVersionFor: (feature: string) => `${feature}-prompt`,
    },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      SYSTEM_ARTICLE_CONTEXT: { role: "system" },
      isArticleOperator: (context: unknown) => (context as { role?: string } | null)?.role === "system",
      loadAiProcessableArticleText: async () => defaultArticle,
    },
  });
});

beforeEach(() => {
  configured = true;
  defaultArticle = { title: "Article", content: "Body" };
  chatCalls = [];
  chatResult = "model-output";
});

function makeArticleSpec(overrides: Record<string, unknown> = {}) {
  const persisted: string[] = [];
  return {
    spec: {
      feature: "summary",
      readCache: async () => null,
      buildMessages: (article: { title: string }) => [{ role: "user", content: article.title }],
      parse: (text: string) => text.toUpperCase(),
      isEmpty: (parsed: string) => parsed.length === 0,
      persist: async (_articleId: string, parsed: string) => {
        persisted.push(parsed);
        return `stored:${parsed}`;
      },
      toResult: (cache: string, ctx: { cached: boolean }) => `${ctx.cached ? "cached" : "fresh"}:${cache}`,
      fallback: (article: { title: string }) => `fallback:${article.title}`,
      ...overrides,
    },
    persisted,
  };
}

test("getOrCreateArticleAi returns null when access-checked custom loading misses", async () => {
  const { getOrCreateArticleAi } = await import("@/lib/ai/cache");
  const { spec } = makeArticleSpec({
    loadArticle: async () => null,
  });

  assert.equal(await getOrCreateArticleAi("article-1", spec as never, { userId: "u1" } as never), null);
  assert.equal(chatCalls.length, 0);
});

test("getOrCreateArticleAi returns cached rows before article loading or model calls", async () => {
  const { getOrCreateArticleAi } = await import("@/lib/ai/cache");
  const { spec } = makeArticleSpec({
    readCache: async () => "cached-row",
  });

  assert.equal(await getOrCreateArticleAi("article-1", spec as never), "cached:cached-row");
  assert.equal(chatCalls.length, 0);
});

test("getOrCreateArticleAi falls back without caching when AI is unconfigured", async () => {
  const { getOrCreateArticleAi } = await import("@/lib/ai/cache");
  configured = false;
  const { spec, persisted } = makeArticleSpec();

  assert.equal(await getOrCreateArticleAi("article-1", spec as never), "fallback:Article");
  assert.deepEqual(persisted, []);
});

test("getOrCreateArticleAi builds messages, parses, persists, and forwards token metadata", async () => {
  const { getOrCreateArticleAi } = await import("@/lib/ai/cache");
  const { spec, persisted } = makeArticleSpec({ maxOutputTokens: 33 });

  assert.equal(await getOrCreateArticleAi("article-1", spec as never), "fresh:stored:MODEL-OUTPUT");
  assert.deepEqual(persisted, ["MODEL-OUTPUT"]);
  assert.equal(chatCalls[0].options.articleId, "article-1");
  assert.equal(chatCalls[0].options.promptVersion, "summary-prompt");
  assert.equal(chatCalls[0].options.maxOutputTokens, 33);
});

test("getOrCreateArticleAi supports custom generation and graceful empty/misconfigured fallbacks", async () => {
  const { getOrCreateArticleAi } = await import("@/lib/ai/cache");
  const generated = makeArticleSpec({
    buildMessages: undefined,
    parse: undefined,
    generate: async (_article: unknown, { callModel }: { callModel: Function }) => {
      const text = await callModel([{ role: "user", content: "custom" }], { maxOutputTokens: 7 });
      return text ? `generated:${text}` : null;
    },
  });
  assert.equal(
    await getOrCreateArticleAi("article-1", generated.spec as never),
    "fresh:stored:generated:model-output",
  );
  assert.equal(chatCalls.at(-1)?.options.maxOutputTokens, 7);

  const empty = makeArticleSpec({ parse: () => "" });
  assert.equal(await getOrCreateArticleAi("article-1", empty.spec as never), "fallback:Article");

  const misconfigured = makeArticleSpec({ buildMessages: undefined, parse: undefined });
  assert.equal(await getOrCreateArticleAi("article-1", misconfigured.spec as never), "fallback:Article");
});

test("getOrCreateSelectionAi forwards article and max-token options", async () => {
  const { getOrCreateSelectionAi } = await import("@/lib/ai/cache");
  const result = await getOrCreateSelectionAi({
    feature: "selection",
    articleId: "article-9",
    maxOutputTokens: 44,
    readCache: async () => null,
    fallback: () => "fallback",
    generate: async (callModel) => (await callModel([{ role: "user", content: "selection" }])) ?? "",
    persist: async (text) => `stored:${text}`,
  });

  assert.equal(result, "stored:model-output");
  assert.equal(chatCalls.at(-1)?.options.articleId, "article-9");
  assert.equal(chatCalls.at(-1)?.options.maxOutputTokens, 44);
});
