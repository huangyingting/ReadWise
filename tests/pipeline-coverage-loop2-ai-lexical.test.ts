process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let azureConfig: null | {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  apiKey: string;
} = null;
const originalFetch = globalThis.fetch;
let fetchImpl: typeof fetch;

let tutorArticle: { title: string; content: string } | null = null;
let tutorRows: Array<{ id: string; role: string; content: string; createdAt: Date }> = [];
let priorRows: Array<{ role: string; content: string }> = [];
let aiConfigured = true;
let completion: string | null = "Helpful answer.";
let transactions: unknown[][] = [];
let getAiProcessableCalls = 0;
let articleFindUniqueCalls = 0;

const createdAt = new Date("2026-01-01T00:00:00Z");

before(() => {
  mock.module("@/lib/runtime-config/ai", {
    namedExports: {
      aiConfig: {
        isConfigured: () => azureConfig !== null,
        get: () => azureConfig,
      },
      aiMaxContextTokens: () => 12345,
      aiDefaultMaxOutputTokens: () => 321,
    },
  });
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => ({ warn: () => {}, info: () => {}, error: () => {} }),
    },
  });
  mock.module("@/lib/runtime-config/dictionary", {
    namedExports: {
      dictionaryProviderMode: () => process.env.DICTIONARY_PROVIDER ?? "local",
      localDictionaryDir: () => "dict",
      localDictionaryLanguage: () => "en",
    },
  });
  mock.module("@/lib/http", {
    namedExports: {
      providerFetch: async (url: string) => fetchImpl(url),
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findUnique: async () => {
            articleFindUniqueCalls++;
            return tutorArticle;
          },
        },
        tutorMessage: {
          findMany: async (args: { select?: Record<string, boolean>; orderBy?: { createdAt: string }; take?: number }) => {
            if (args.select?.id) return tutorRows;
            return priorRows;
          },
          create: (args: unknown) => args,
          deleteMany: async () => ({ count: 1 }),
        },
        $transaction: async (ops: unknown[]) => {
          transactions.push(ops);
          return ops;
        },
      },
    },
  });
  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => aiConfigured,
      chatComplete: async () => completion,
    },
  });
  mock.module("@/lib/content-pipeline", {
    namedExports: {
      articleHtmlToReaderText: () => "Neutral article sentence. ".repeat(400),
    },
  });
  mock.module("@/lib/ai/output/moderation", {
    namedExports: {
      MODERATION_FALLBACK_MESSAGE: "I can’t help with that request.",
      moderateText: (text: string) => ({ flagged: /unsafe/i.test(text) }),
    },
  });
  mock.module("@/lib/ai/prompts", {
    namedExports: {
      renderPrompt: (_kind: string, args: Record<string, string>) => [
        { role: "system", content: `level:${args.level}; title:${args.title}; chars:${args.articleText.length}` },
        { role: "user", content: args.question },
      ],
      promptModelParams: () => ({ maxOutputTokens: 200 }),
      activePromptVersion: () => "v-test",
    },
  });
  mock.module("@/lib/profile", {
    namedExports: {
      getProfile: async () => ({ englishLevel: "B2" }),
    },
  });
  mock.module("@/lib/learning/coach-memory", {
    namedExports: {
      buildTutorContext: async () => "Coach summary: prefers concise explanations.",
    },
  });
  mock.module("@/lib/learning/primitives", {
    namedExports: {
      bestEffortMastery: async (_key: string, fn: () => Promise<string>) => fn(),
    },
  });
  mock.module("@/lib/article-library", {
    namedExports: {
      SYSTEM_ARTICLE_CONTEXT: { role: "system" },
      isArticleOperator: (context: unknown) => (context as { role?: string } | null)?.role === "system",
      getAiProcessableArticleById: async () => {
        getAiProcessableCalls++;
        return tutorArticle;
      },
    },
  });
  mock.module("@/lib/i18n", {
    namedExports: {
      t: (key: string) => `translated:${key}`,
    },
  });
});

beforeEach(() => {
  azureConfig = null;
  globalThis.fetch = originalFetch;
  fetchImpl = globalThis.fetch;
  tutorArticle = { title: "Tutor Article", content: "<p>Body</p>" };
  tutorRows = [{ id: "m1", role: "assistant", content: "Earlier reply", createdAt }];
  priorRows = [
    { role: "assistant", content: "Earlier reply" },
    { role: "user", content: "Earlier question" },
  ];
  aiConfigured = true;
  completion = "Helpful answer.";
  transactions = [];
  getAiProcessableCalls = 0;
  articleFindUniqueCalls = 0;
  delete process.env.DICTIONARY_PROVIDER;
});

test("Azure provider reports unconfigured, forwards temperature-capable subclasses, and classifies throws", async () => {
  const { AzureOpenAiProvider } = await import("@/lib/ai/azure-provider");
  const provider = new AzureOpenAiProvider();
  assert.equal(provider.isConfigured(), false);
  assert.equal(provider.modelName(), null);
  const unconfigured = await provider.chat({ messages: [] });
  if (unconfigured.ok) assert.fail("expected unconfigured provider failure");
  assert.equal(unconfigured.error.kind, "unconfigured");

  azureConfig = {
    endpoint: "https://azure.example",
    deployment: "model-test",
    apiVersion: "2026-01-01",
    apiKey: "placeholder-key",
  };
  assert.equal(provider.isConfigured(), true);
  assert.equal(provider.modelName(), "model-test");

  fetchImpl = (async () =>
    new Response("busy", {
      status: 503,
      headers: { "Retry-After": "2" },
    })) as typeof fetch;
  globalThis.fetch = fetchImpl;
  const httpFailure = await provider.chat({ messages: [] });
  if (httpFailure.ok) assert.fail("expected HTTP failure");
  assert.equal(httpFailure.error.status, 503);
  assert.equal(httpFailure.error.retryAfterMs, 2000);

  fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "   " }, finish_reason: "content_filter" }],
        usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
      }),
      { status: 200 },
    )) as typeof fetch;
  globalThis.fetch = fetchImpl;
  const filtered = await provider.chat({ messages: [] });
  if (filtered.ok) assert.fail("expected content filter fallback");
  assert.equal(filtered.error.kind, "content_filter");
  assert.equal(filtered.error.finishReason, "content_filter");

  let postedBody: Record<string, unknown> | null = null;
  fetchImpl = (async (_url, init) => {
    postedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "  Generated answer.  " }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        model: "model-test",
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  globalThis.fetch = fetchImpl;

  class TemperatureProvider extends AzureOpenAiProvider {
    override capabilities() {
      return {
        provider: this.id,
        maxContextTokens: 10,
        defaultMaxOutputTokens: 5,
        supportsTemperature: true,
        tokenParamName: "max_tokens" as const,
      };
    }
  }

  const ok = await new TemperatureProvider().chat({
    messages: [{ role: "user", content: "Hello" }],
    temperature: 0.2,
  });
  assert.equal(ok.ok, true);
  const body = postedBody as unknown as Record<string, unknown>;
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 5);

  fetchImpl = (async () => {
    throw new TypeError("network down");
  }) as typeof fetch;
  globalThis.fetch = fetchImpl;
  const failed = await provider.chat({ messages: [] });
  if (failed.ok) assert.fail("expected thrown fetch to be classified");
  assert.equal(failed.error.retryable, true);
});

test("FreeDictionaryProvider handles phonetic fallback, empty meanings, and default provider modes", async () => {
  const {
    FallbackDictionaryProvider,
    FreeDictionaryProvider,
    LocalDictionaryProvider,
    createDefaultDictionaryProvider,
  } = await import("@/lib/lexical/provider");

  fetchImpl = (async () =>
    new Response(
      JSON.stringify([
        {
          phonetic: " /raw/ ",
          phonetics: [{ text: " /fəˈnetɪk/ ", audio: " https://audio.example/file.mp3 " }],
          meanings: [
            {
              partOfSpeech: "",
              definitions: [
                { definition: " first definition ", example: " example sentence " },
                { definition: " second definition " },
              ],
            },
          ],
        },
      ]),
      { status: 200 },
    )) as typeof fetch;
  const parsed = await new FreeDictionaryProvider().fetchEntry("phonetic");
  assert.equal(parsed?.phonetic, "/raw/");
  assert.equal(parsed?.audio, "https://audio.example/file.mp3");
  assert.equal(parsed?.meanings[0].partOfSpeech, "other");

  fetchImpl = (async () =>
    new Response(
      JSON.stringify([
        {
          phonetics: [{ text: " /fallback/ " }],
          meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "defined" }] }],
        },
      ]),
      { status: 200 },
    )) as typeof fetch;
  assert.equal((await new FreeDictionaryProvider().fetchEntry("fallback"))?.phonetic, "/fallback/");

  const local = new LocalDictionaryProvider({
    directory: "tests/fixtures/dict-loop2",
    dictionary: "en",
  });
  const localEntry = await local.fetchEntry(" VALID ");
  assert.equal(localEntry?.phonetic, "/valid/");
  assert.deepEqual(
    localEntry?.meanings.map((meaning) => meaning.partOfSpeech),
    ["noun", "definition"],
  );
  assert.equal(await local.fetchEntry("empty"), null);
  assert.equal(
    await new LocalDictionaryProvider({ directory: "tests/fixtures/missing-dict-loop2" }).fetchEntry("valid"),
    null,
  );

  fetchImpl = (async () =>
    new Response(JSON.stringify([{ meanings: [{ partOfSpeech: "noun", definitions: [] }] }]), {
      status: 200,
    })) as typeof fetch;
  assert.equal(await new FreeDictionaryProvider().fetchEntry("empty"), null);
  fetchImpl = (async () => new Response("not found", { status: 404 })) as typeof fetch;
  assert.equal(await new FreeDictionaryProvider().fetchEntry("missing"), null);
  fetchImpl = (async () => {
    throw new Error("network failed");
  }) as typeof fetch;
  assert.equal(await new FreeDictionaryProvider().fetchEntry("network"), null);
  fetchImpl = (async () => new Response(JSON.stringify([]), { status: 200 })) as typeof fetch;
  assert.equal(await new FreeDictionaryProvider().fetchEntry("none"), null);

  const allMiss = new FallbackDictionaryProvider([
    { fetchEntry: async () => null },
    { fetchEntry: async () => null },
  ]);
  assert.equal(await allMiss.fetchEntry("missing"), null);

  process.env.DICTIONARY_PROVIDER = "hybrid";
  assert.ok(createDefaultDictionaryProvider() instanceof FallbackDictionaryProvider);
  process.env.DICTIONARY_PROVIDER = "free";
  assert.ok(createDefaultDictionaryProvider() instanceof FreeDictionaryProvider);
  process.env.DICTIONARY_PROVIDER = "local";
  assert.ok(createDefaultDictionaryProvider() instanceof LocalDictionaryProvider);
});

test("askTutor returns moderation fallback without persistence for unsafe questions", async () => {
  const { askTutor } = await import("@/lib/ai/tutor");

  const result = await askTutor("user-1", "article-1", "unsafe request");

  assert.equal(result?.fallback, true);
  assert.equal(result?.answer, "I can’t help with that request.");
  assert.equal(transactions.length, 0);
  assert.equal(articleFindUniqueCalls, 1);
});

test("askTutor uses access-checked article loading, truncates grounding, and persists safe answers", async () => {
  const { askTutor } = await import("@/lib/ai/tutor");

  const result = await askTutor(
    "user-1",
    "article-1",
    "Explain this paragraph",
    { userId: "user-1" } as never,
    "Current paragraph ".repeat(80),
  );

  assert.equal(result?.fallback, false);
  assert.equal(result?.answer, "Helpful answer.");
  assert.equal(getAiProcessableCalls, 1);
  assert.equal(articleFindUniqueCalls, 0);
  assert.equal(transactions.length, 1);
  const createdUserMessage = transactions[0][0] as { data: { content: string } };
  assert.equal(createdUserMessage.data.content, "Explain this paragraph");
});

test("askTutor degrades without persistence when AI is unavailable or answer moderation fails", async () => {
  const { askTutor } = await import("@/lib/ai/tutor");

  completion = null;
  const unavailable = await askTutor("user-1", "article-1", "Help me understand");
  assert.equal(unavailable?.fallback, true);
  assert.equal(unavailable?.answer, "translated:ai.tutor.unavailable");
  assert.equal(transactions.length, 0);

  completion = "unsafe model answer";
  const moderated = await askTutor("user-1", "article-1", "Help me understand");
  assert.equal(moderated?.fallback, true);
  assert.equal(moderated?.answer, "I can’t help with that request.");
  assert.equal(transactions.length, 0);
});
