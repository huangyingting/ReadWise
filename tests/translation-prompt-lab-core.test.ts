import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  ALL_CATEGORIES,
  ALL_PROFILES,
  CATEGORY_PROFILE,
  profileForCategory,
} from "../scripts/translation-prompt-lab/categories";
import { chunkArticleText, estimateTokens } from "../scripts/translation-prompt-lab/chunk";
import { mapWithConcurrency } from "../scripts/translation-prompt-lab/concurrency";
import { openReadOnly, openReadWrite } from "../scripts/translation-prompt-lab/db";
import {
  allVariants,
  recommendedPrompt,
  recommendedPromptForCategory,
  variantById,
  variantsForProfile,
} from "../scripts/translation-prompt-lab/prompts";
import {
  ensureParentDirExists,
  getExistingHash,
  openTranslationStore,
  recordError,
  upsertTranslation,
} from "../scripts/translation-prompt-lab/store";
import {
  chatComplete,
  chatCompleteWithRetry,
  type ChatMessage,
} from "../scripts/translation-prompt-lab/vllm-client";

test("translation profiles cover every category with a safe narrative fallback", () => {
  assert.equal(ALL_CATEGORIES.length, 14);
  assert.deepEqual(ALL_PROFILES, ["news", "technical", "narrative", "sports"]);
  for (const category of ALL_CATEGORIES) {
    assert.equal(profileForCategory(category), CATEGORY_PROFILE[category]);
  }
  assert.equal(profileForCategory("unknown"), "narrative");
  assert.equal(profileForCategory(null), "narrative");
  assert.equal(profileForCategory(undefined), "narrative");
});

test("translation prompts expose stable baseline and specialized variants", () => {
  const variants = allVariants();
  assert.equal(variants.length, 8);
  for (const profile of ALL_PROFILES) {
    const pair = variantsForProfile(profile);
    assert.equal(pair.length, 2);
    assert.match(pair[0]!.id, /v1-baseline$/);
    assert.equal(recommendedPrompt(profile).id, pair[1]!.id);
    assert.match(pair[1]!.systemPrompt, /Simplified Chinese/);
  }
  assert.equal(variantById("news/v2-specialized")?.profile, "news");
  assert.equal(variantById("missing"), undefined);
  assert.equal(recommendedPromptForCategory("science").profile, "technical");
  assert.equal(recommendedPromptForCategory(null).profile, "narrative");
});

test("paragraph-aware chunking covers empty, paragraph, sentence, and hard-split paths", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("12345"), 2);
  assert.deepEqual(chunkArticleText("\n\n  \n", 100), []);

  const paragraphs = chunkArticleText(`${"a".repeat(120)}\n\n${"b".repeat(120)}`, 50);
  assert.equal(paragraphs.length, 2);
  assert.ok(paragraphs.every((chunk) => chunk.total === 2));
  assert.deepEqual(paragraphs.map((chunk) => chunk.index), [0, 1]);

  const sentenceSplit = chunkArticleText(`${"A".repeat(110)}. ${"B".repeat(110)}!`, 50);
  assert.equal(sentenceSplit.length, 2);
  assert.ok(sentenceSplit[0]!.text.endsWith("."));

  const hardSplit = chunkArticleText("x".repeat(450), 1);
  assert.deepEqual(hardSplit.map((chunk) => chunk.charCount), [200, 200, 50]);

  const combined = chunkArticleText("short one\n\nshort two", 100);
  assert.equal(combined.length, 1);
  assert.equal(combined[0]!.text, "short one\n\nshort two");
});

test("concurrency mapper clamps its worker count and preserves input order", async () => {
  const settled: number[] = [];
  const result = await mapWithConcurrency(
    [3, 1, 2],
    0,
    async (value, index) => {
      await Promise.resolve();
      return `${index}:${value}`;
    },
    (_result, value) => settled.push(value),
  );
  assert.deepEqual(result, ["0:3", "1:1", "2:2"]);
  assert.deepEqual(settled, [3, 1, 2]);
  assert.deepEqual(await mapWithConcurrency([], 4, async (value) => value), []);
});

test("SQLite helpers open writable and strictly read-only databases", () => {
  const dir = mkdtempSync(join(tmpdir(), "readwise-translation-db-"));
  const path = join(dir, "fixture.sqlite");
  const writable = openReadWrite(path);
  writable.exec("CREATE TABLE Item (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
  writable.prepare("INSERT INTO Item (id, value) VALUES (?, ?)").run("one", "value");
  writable.close();

  const readonly = openReadOnly(path);
  assert.deepEqual(readonly.prepare("SELECT id, value FROM Item").all(), [{ id: "one", value: "value" }]);
  assert.throws(() => readonly.prepare("INSERT INTO Item (id, value) VALUES (?, ?)").run("two", "x"));
  readonly.close();
});

test("translation store creates schema, upserts idempotently, and records controlled errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "readwise-translation-store-"));
  const path = join(dir, "nested", "translations.sqlite");
  assert.equal(existsSync(join(dir, "nested")), false);
  ensureParentDirExists(path);
  assert.equal(existsSync(join(dir, "nested")), true);
  ensureParentDirExists(path);

  const db = openTranslationStore(path);
  assert.equal(getExistingHash(db, "provider", "article", "zh-CN"), null);
  const base = {
    providerDb: "provider",
    articleId: "article",
    targetLang: "zh-CN",
    titleTranslated: "标题",
    contentTranslated: "第一段",
    sourceBlockCount: 1,
    chunkCount: 1,
    repairedChunkCount: 0,
    contentHash: "hash-1",
    model: "model",
    promptVariantId: "news/v2-specialized",
    qaFlags: ["flag"],
    durationMs: 12,
  };
  upsertTranslation(db, base);
  assert.equal(getExistingHash(db, "provider", "article", "zh-CN"), "hash-1");
  upsertTranslation(db, { ...base, contentTranslated: "第二段", contentHash: "hash-2", qaFlags: [] });
  assert.deepEqual(
    db.prepare("SELECT contentTranslated, contentHash, qaFlags FROM ArticleTranslation").get(),
    { contentTranslated: "第二段", contentHash: "hash-2", qaFlags: "[]" },
  );
  recordError(db, "provider", "article", "zh-CN", "controlled_failure");
  assert.deepEqual(db.prepare("SELECT error FROM ArticleTranslationError").get(), { error: "controlled_failure" });
  db.close();
});

const MESSAGES: ChatMessage[] = [{ role: "user", content: "hello" }];

test("vLLM client sends bounded defaults and maps completion usage", async (t) => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "  译文  " }, finish_reason: "stop" }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch);

  const result = await chatComplete(MESSAGES, { baseUrl: "http://local/v1", model: "model", timeoutMs: 500 });
  assert.equal(requestUrl, "http://local/v1/chat/completions");
  assert.deepEqual(requestBody.chat_template_kwargs, { enable_thinking: false });
  assert.equal(requestBody.temperature, 0.3);
  assert.equal(requestBody.max_tokens, 3072);
  assert.equal(result.text, "译文");
  assert.deepEqual(result.usage, { promptTokens: 2, completionTokens: 3, totalTokens: 5 });
});

test("vLLM client covers explicit options and absent usage", async (t) => {
  let requestBody: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  }) as typeof fetch);

  const result = await chatComplete(MESSAGES, {
    temperature: 0,
    maxTokens: 10,
    enableThinking: true,
    timeoutMs: 500,
  });
  assert.equal(requestBody.temperature, 0);
  assert.equal(requestBody.max_tokens, 10);
  assert.deepEqual(requestBody.chat_template_kwargs, { enable_thinking: true });
  assert.equal(result.finishReason, null);
  assert.equal(result.usage, null);
});

test("vLLM client reports HTTP and empty-completion failures", async (t) => {
  const responses = [
    new Response("provider down", { status: 503, statusText: "Unavailable" }),
    new Response(JSON.stringify({ choices: [{ message: { content: null, reasoning: "thinking" }, finish_reason: "length" }] }), { status: 200 }),
    new Response(JSON.stringify({ choices: [] }), { status: 200 }),
  ];
  t.mock.method(globalThis, "fetch", (async () => responses.shift()!) as typeof fetch);

  await assert.rejects(() => chatComplete(MESSAGES, { timeoutMs: 500 }), /503 Unavailable provider down/);
  await assert.rejects(() => chatComplete(MESSAGES, { timeoutMs: 500 }), /only reasoning tokens/);
  await assert.rejects(() => chatComplete(MESSAGES, { timeoutMs: 500 }), /finish_reason=unknown/);
});

test("vLLM retry helper retries transient errors and rethrows the final failure", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", (async () => {
    calls += 1;
    if (calls === 1) return new Response("transient", { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "recovered" } }] }), { status: 200 });
  }) as typeof fetch);

  assert.equal((await chatCompleteWithRetry(MESSAGES, { timeoutMs: 500 }, 2)).text, "recovered");
  assert.equal(calls, 2);

  t.mock.method(globalThis, "fetch", (async () => new Response("still down", { status: 500 })) as typeof fetch);
  await assert.rejects(() => chatCompleteWithRetry(MESSAGES, { timeoutMs: 500 }, 1), /vLLM request failed/);
});
