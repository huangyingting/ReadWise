import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { isAiConfigured, aiModelName, chatComplete, chatCompleteWithMeta } from "@/lib/ai";
import { enableAi, disableAi } from "./helpers";

// Disable retries for backward-compat tests to keep them fast.
before(() => {
  process.env.AI_MAX_RETRIES = "0";
  process.env.AI_REQUEST_TIMEOUT_MS = "5000";
});
after(() => {
  delete process.env.AI_MAX_RETRIES;
  delete process.env.AI_REQUEST_TIMEOUT_MS;
});

test("isAiConfigured / aiModelName reflect env configuration", () => {
  disableAi();
  assert.equal(isAiConfigured(), false);
  assert.equal(aiModelName(), null);
  enableAi();
  assert.equal(isAiConfigured(), true);
  assert.equal(aiModelName(), "gpt-test");
  disableAi();
});

test("chatComplete returns null when unconfigured (no network call)", async (t) => {
  disableAi();
  const original = globalThis.fetch;
  let called = false;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const result = await chatComplete([{ role: "user", content: "hi" }]);
  assert.equal(result, null);
  assert.equal(called, false);
});

test("chatComplete posts to Azure and returns assistant text", async (t) => {
  enableAi();
  const original = globalThis.fetch;
  let sentBody: unknown;
  t.after(() => {
    globalThis.fetch = original;
    disableAi();
  });
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "  hello world  " } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: "gpt-test",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await chatComplete([{ role: "user", content: "hi" }], {
    maxOutputTokens: 32,
  });
  assert.equal(result, "hello world");
  assert.deepEqual((sentBody as { max_completion_tokens: number }).max_completion_tokens, 32);
});

test("chatComplete returns null on a non-2xx response", async (t) => {
  enableAi();
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    disableAi();
  });
  globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  assert.equal(await chatComplete([{ role: "user", content: "x" }]), null);
});

test("chatCompleteWithMeta returns usage + model metadata", async (t) => {
  enableAi();
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    disableAi();
  });
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        model: "gpt-test-deploy",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  const result = await chatCompleteWithMeta([{ role: "user", content: "hi" }], { feature: "quiz" });
  assert.ok(result);
  assert.equal(result.text, "ok");
  assert.deepEqual(result.usage, { promptTokens: 8, completionTokens: 3, totalTokens: 11 });
  assert.equal(result.model, "gpt-test-deploy");
  assert.ok(result.durationMs >= 0);
});

test("chatComplete retries on 429 then succeeds", async (t) => {
  process.env.AI_MAX_RETRIES = "1";
  process.env.AI_REQUEST_TIMEOUT_MS = "5000";
  enableAi();
  const original = globalThis.fetch;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = original;
    disableAi();
    process.env.AI_MAX_RETRIES = "0";
  });
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) return new Response("rate limited", { status: 429 });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "retried" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await chatComplete([{ role: "user", content: "hi" }]);
  assert.equal(result, "retried");
  assert.equal(calls, 2);
});

test("chatComplete returns null after exhausting retries", async (t) => {
  process.env.AI_MAX_RETRIES = "1";
  process.env.AI_REQUEST_TIMEOUT_MS = "5000";
  enableAi();
  const original = globalThis.fetch;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = original;
    disableAi();
    process.env.AI_MAX_RETRIES = "0";
  });
  globalThis.fetch = (async () => {
    calls++;
    return new Response("server error", { status: 503 });
  }) as typeof fetch;

  const result = await chatComplete([{ role: "user", content: "hi" }]);
  assert.equal(result, null);
  assert.equal(calls, 2); // 1 initial + 1 retry
});

