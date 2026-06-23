import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chatComplete, chatCompleteWithMeta, isAiConfigured, aiModelName, aiProviderCapabilities } from "@/lib/ai";
import {
  classifyHttpStatus,
  classifyThrownError,
  parseRetryAfterMs,
  type AiChatRequest,
  type AiChatResponse,
  type AiProvider,
  type AiProviderCapabilities,
} from "@/lib/ai/provider";
import { getAiProvider, setAiProvider, resetAiProvider } from "@/lib/ai/registry";

const CAPS: AiProviderCapabilities = {
  provider: "fake",
  maxContextTokens: 8000,
  defaultMaxOutputTokens: 1024,
  supportsTemperature: true,
  tokenParamName: "max_tokens",
};

/** A scriptable fake provider used to drive the orchestration in `@/lib/ai`. */
class FakeProvider implements AiProvider {
  readonly id = "fake";
  configured = true;
  queue: AiChatResponse[] = [];
  calls: AiChatRequest[] = [];

  isConfigured(): boolean {
    return this.configured;
  }
  modelName(): string | null {
    return this.configured ? "fake-model" : null;
  }
  capabilities(): AiProviderCapabilities {
    return CAPS;
  }
  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    this.calls.push(request);
    const next = this.queue.shift();
    if (!next) {
      return { ok: false, durationMs: 1, error: { kind: "unknown", retryable: false, message: "no script" } };
    }
    return next;
  }
}

function ok(text: string): AiChatResponse {
  return {
    ok: true,
    text,
    usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    model: "fake-model",
    finishReason: "stop",
    durationMs: 1,
    status: 200,
  };
}

beforeEach(() => {
  process.env.AI_MAX_RETRIES = "2";
  process.env.AI_REQUEST_TIMEOUT_MS = "5000";
});

afterEach(() => {
  resetAiProvider();
  delete process.env.AI_MAX_RETRIES;
  delete process.env.AI_REQUEST_TIMEOUT_MS;
  delete process.env.AI_PROVIDER;
});

test("setAiProvider seam: chatComplete delegates to the injected provider", async () => {
  const fake = new FakeProvider();
  fake.queue.push(ok("hello from fake"));
  setAiProvider(fake);

  assert.equal(isAiConfigured(), true);
  assert.equal(aiModelName(), "fake-model");
  const result = await chatComplete([{ role: "user", content: "hi" }], { feature: "test" });
  assert.equal(result, "hello from fake");
  assert.equal(fake.calls.length, 1);
});

test("chatCompleteWithMeta returns normalized usage + model from the provider", async () => {
  const fake = new FakeProvider();
  fake.queue.push(ok("answer"));
  setAiProvider(fake);

  const meta = await chatCompleteWithMeta([{ role: "user", content: "hi" }], { feature: "test" });
  assert.ok(meta);
  assert.equal(meta.text, "answer");
  assert.deepEqual(meta.usage, { promptTokens: 5, completionTokens: 2, totalTokens: 7 });
  assert.equal(meta.model, "fake-model");
});

test("an unconfigured provider yields a graceful null (no chat call)", async () => {
  const fake = new FakeProvider();
  fake.configured = false;
  setAiProvider(fake);

  assert.equal(isAiConfigured(), false);
  const result = await chatComplete([{ role: "user", content: "hi" }]);
  assert.equal(result, null);
  assert.equal(fake.calls.length, 0);
});

test("retryable provider error is retried, then succeeds", async () => {
  const fake = new FakeProvider();
  fake.queue.push({ ok: false, durationMs: 1, error: { kind: "rate_limit", retryable: true, status: 429, message: "429", retryAfterMs: 0 } });
  fake.queue.push(ok("recovered"));
  setAiProvider(fake);

  const result = await chatComplete([{ role: "user", content: "hi" }], { feature: "test" });
  assert.equal(result, "recovered");
  assert.equal(fake.calls.length, 2);
});

test("retries are exhausted on persistent retryable errors → null", async () => {
  const fake = new FakeProvider();
  for (let i = 0; i < 5; i++) {
    fake.queue.push({ ok: false, durationMs: 1, error: { kind: "server", retryable: true, status: 503, message: "503", retryAfterMs: 0 } });
  }
  setAiProvider(fake);

  const result = await chatComplete([{ role: "user", content: "hi" }], { feature: "test" });
  assert.equal(result, null);
  // 1 initial + 2 retries (AI_MAX_RETRIES=2).
  assert.equal(fake.calls.length, 3);
});

test("non-retryable auth error fails fast → null (no retry)", async () => {
  const fake = new FakeProvider();
  fake.queue.push({ ok: false, durationMs: 1, error: { kind: "auth", retryable: false, status: 401, message: "401" } });
  setAiProvider(fake);

  const result = await chatComplete([{ role: "user", content: "hi" }], { feature: "test" });
  assert.equal(result, null);
  assert.equal(fake.calls.length, 1);
});

test("empty and content_filter outcomes degrade to null without retry", async () => {
  for (const kind of ["empty", "content_filter"] as const) {
    const fake = new FakeProvider();
    fake.queue.push({ ok: false, durationMs: 1, error: { kind, retryable: false, status: 200, message: kind, finishReason: kind } });
    setAiProvider(fake);
    const result = await chatComplete([{ role: "user", content: "hi" }], { feature: "test" });
    assert.equal(result, null);
    assert.equal(fake.calls.length, 1);
    resetAiProvider();
  }
});

// ---- pure error classification --------------------------------------------

test("classifyHttpStatus maps statuses to retryable-aware kinds", () => {
  assert.deepEqual(classifyHttpStatus(429), { kind: "rate_limit", retryable: true });
  assert.deepEqual(classifyHttpStatus(401), { kind: "auth", retryable: false });
  assert.deepEqual(classifyHttpStatus(403), { kind: "auth", retryable: false });
  assert.deepEqual(classifyHttpStatus(503), { kind: "server", retryable: true });
  assert.deepEqual(classifyHttpStatus(400), { kind: "bad_request", retryable: false });
});

test("classifyThrownError distinguishes timeout / abort / network", () => {
  const timeout = new Error("t");
  timeout.name = "TimeoutError";
  assert.equal(classifyThrownError(timeout).kind, "timeout");
  assert.equal(classifyThrownError(timeout).retryable, true);

  const abort = new Error("a");
  abort.name = "AbortError";
  assert.equal(classifyThrownError(abort).kind, "aborted");
  assert.equal(classifyThrownError(abort).retryable, false);

  assert.equal(classifyThrownError(new Error("boom")).kind, "network");
  assert.equal(classifyThrownError(new Error("boom")).retryable, true);
});

test("parseRetryAfterMs parses seconds and clamps", () => {
  assert.equal(parseRetryAfterMs(null), undefined);
  assert.equal(parseRetryAfterMs("not-a-number"), undefined);
  assert.equal(parseRetryAfterMs("2"), 2000);
  assert.equal(parseRetryAfterMs("100000"), 60000);
});

// ---- registry / default provider ------------------------------------------

test("default provider is Azure with gpt-5-mini quirks encoded", () => {
  resetAiProvider();
  delete process.env.AI_PROVIDER;
  const caps = aiProviderCapabilities();
  assert.equal(caps.provider, "azure-openai");
  assert.equal(caps.supportsTemperature, false);
  assert.equal(caps.tokenParamName, "max_completion_tokens");
  assert.ok(caps.maxContextTokens > 0);
});

test("unknown AI_PROVIDER selector degrades to Azure (no crash)", () => {
  resetAiProvider();
  process.env.AI_PROVIDER = "does-not-exist";
  const provider = getAiProvider();
  assert.equal(provider.id, "azure-openai");
});
