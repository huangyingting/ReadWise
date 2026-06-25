/**
 * AI request runner (REF-026) — representative fixture tests.
 *
 * Exercises `runAiRequest` in isolation with a scriptable FakeProvider to
 * prove that every terminal outcome (success, empty, content-filter, aborted,
 * retry→success, retry exhausted, terminal error) returns the correct
 * discriminated-union result and triggers the `onRetry` callback the right
 * number of times.
 *
 * The runner owns no observability — ledger, metrics, and tracing are the
 * facade's responsibility — so this test deliberately does not check those.
 * Integration evidence that ledger/metrics/tracing are emitted for each outcome
 * is covered by `tests/ai-ledger.test.ts` and `tests/ai-provider.test.ts`.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runAiRequest, type AiRunnerOptions } from "@/lib/ai/runner";
import { setAiProvider, resetAiProvider } from "@/lib/ai/registry";
import {
  type AiChatRequest,
  type AiChatResponse,
  type AiProvider,
  type AiProviderCapabilities,
} from "@/lib/ai/provider";

// ---------------------------------------------------------------------------
// FakeProvider test double
// ---------------------------------------------------------------------------

const CAPS: AiProviderCapabilities = {
  provider: "fake",
  maxContextTokens: 8000,
  defaultMaxOutputTokens: 1024,
  supportsTemperature: true,
  tokenParamName: "max_tokens",
};

class FakeProvider implements AiProvider {
  readonly id = "fake";
  configured = true;
  queue: AiChatResponse[] = [];

  isConfigured(): boolean {
    return this.configured;
  }
  modelName(): string | null {
    return this.configured ? "fake-model" : null;
  }
  capabilities(): AiProviderCapabilities {
    return CAPS;
  }
  async chat(_req: AiChatRequest): Promise<AiChatResponse> {
    const next = this.queue.shift();
    if (!next) {
      return { ok: false, durationMs: 1, error: { kind: "unknown", retryable: false, message: "no script" } };
    }
    return next;
  }
}

function okResponse(text = "hello"): AiChatResponse {
  return {
    ok: true,
    text,
    usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    model: "fake-model",
    finishReason: "stop",
    durationMs: 10,
    status: 200,
  };
}

function retryableError(kind: "rate_limit" | "server" | "timeout" = "rate_limit"): AiChatResponse {
  return { ok: false, durationMs: 5, error: { kind, retryable: true, status: kind === "rate_limit" ? 429 : 503, message: kind, retryAfterMs: 0 } };
}

const BASE_OPTS: AiRunnerOptions = { maxRetries: 2, timeoutMs: 5000 };

let fake: FakeProvider;
beforeEach(() => {
  fake = new FakeProvider();
  setAiProvider(fake);
  // Use short timeouts in tests.
  process.env.AI_MAX_RETRIES = "2";
  process.env.AI_REQUEST_TIMEOUT_MS = "5000";
});
afterEach(() => {
  resetAiProvider();
  delete process.env.AI_MAX_RETRIES;
  delete process.env.AI_REQUEST_TIMEOUT_MS;
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

test("runner: success returns outcome=success with text, usage, model, durationMs", async () => {
  fake.queue.push(okResponse("world"));
  const result = await runAiRequest(fake, [{ role: "user", content: "hi" }], BASE_OPTS);
  assert.equal(result.outcome, "success");
  if (result.outcome !== "success") throw new Error("narrowing");
  assert.equal(result.text, "world");
  assert.deepEqual(result.usage, { promptTokens: 5, completionTokens: 2, totalTokens: 7 });
  assert.equal(result.model, "fake-model");
  assert.ok(result.durationMs >= 0);
  assert.equal(result.status, 200);
});

// ---------------------------------------------------------------------------
// Empty / content-filter paths
// ---------------------------------------------------------------------------

test("runner: empty outcome is returned without retry", async () => {
  fake.queue.push({
    ok: false,
    durationMs: 5,
    error: { kind: "empty", retryable: false, status: 200, message: "empty", finishReason: "stop" },
  });
  const retryCalls: unknown[] = [];
  const result = await runAiRequest(fake, [{ role: "user", content: "hi" }], BASE_OPTS, (i) => retryCalls.push(i));
  assert.equal(result.outcome, "empty");
  assert.equal(retryCalls.length, 0, "no retries for empty");
});

test("runner: content_filter outcome is returned without retry", async () => {
  fake.queue.push({
    ok: false,
    durationMs: 5,
    error: { kind: "content_filter", retryable: false, status: 200, message: "cf", finishReason: "content_filter" },
  });
  const retryCalls: unknown[] = [];
  const result = await runAiRequest(fake, [{ role: "user", content: "hi" }], BASE_OPTS, (i) => retryCalls.push(i));
  assert.equal(result.outcome, "content_filter");
  assert.equal(retryCalls.length, 0, "no retries for content_filter");
});

// ---------------------------------------------------------------------------
// Aborted path
// ---------------------------------------------------------------------------

test("runner: aborted when caller signal is fired", async () => {
  // Return an "aborted" error from the provider.
  fake.queue.push({ ok: false, durationMs: 3, error: { kind: "aborted", retryable: false, message: "aborted" } });
  const controller = new AbortController();
  controller.abort();
  const result = await runAiRequest(
    fake,
    [{ role: "user", content: "hi" }],
    { ...BASE_OPTS, externalSignal: controller.signal },
  );
  assert.equal(result.outcome, "aborted");
});

// ---------------------------------------------------------------------------
// Retry → success
// ---------------------------------------------------------------------------

test("runner: retries a retryable error then succeeds; onRetry fired once", async () => {
  fake.queue.push(retryableError("rate_limit"));
  fake.queue.push(okResponse("recovered"));
  const retryInfos: { attempt: number; reason: string }[] = [];
  const result = await runAiRequest(
    fake,
    [{ role: "user", content: "hi" }],
    { ...BASE_OPTS, maxRetries: 1 },
    (info) => retryInfos.push({ attempt: info.attempt, reason: info.reason }),
  );
  assert.equal(result.outcome, "success");
  if (result.outcome !== "success") throw new Error("narrowing");
  assert.equal(result.text, "recovered");
  assert.equal(retryInfos.length, 1);
  assert.equal(retryInfos[0].attempt, 0);
  assert.equal(retryInfos[0].reason, "rate_limit");
});

test("runner: honors retryAfterMs=0 (no sleep delay in tests)", async () => {
  fake.queue.push(retryableError("server"));
  fake.queue.push(okResponse("ok"));
  const start = Date.now();
  const result = await runAiRequest(
    fake,
    [{ role: "user", content: "hi" }],
    { ...BASE_OPTS, maxRetries: 1 },
  );
  assert.equal(result.outcome, "success");
  // With retryAfterMs=0 the loop should complete quickly (< 2 s in any env).
  assert.ok(Date.now() - start < 2000, "retry with retryAfterMs=0 should be fast");
});

// ---------------------------------------------------------------------------
// Terminal error — retries exhausted
// ---------------------------------------------------------------------------

test("runner: terminal error after exhausting retries (maxRetries=2 → 3 attempts)", async () => {
  for (let i = 0; i < 5; i++) fake.queue.push(retryableError("server"));
  const retryCalls: number[] = [];
  const result = await runAiRequest(
    fake,
    [{ role: "user", content: "hi" }],
    { ...BASE_OPTS, maxRetries: 2 },
    (i) => retryCalls.push(i.attempt),
  );
  assert.equal(result.outcome, "error");
  if (result.outcome !== "error") throw new Error("narrowing");
  assert.equal(result.attemptsMade, 3);
  assert.equal(retryCalls.length, 2, "onRetry fires for each retry (not the terminal attempt)");
  assert.equal(result.errorKind, "server");
});

test("runner: non-retryable auth error → immediate terminal error, no retries", async () => {
  fake.queue.push({ ok: false, durationMs: 5, error: { kind: "auth", retryable: false, status: 401, message: "401" } });
  const retryCalls: unknown[] = [];
  const result = await runAiRequest(
    fake,
    [{ role: "user", content: "hi" }],
    BASE_OPTS,
    (i) => retryCalls.push(i),
  );
  assert.equal(result.outcome, "error");
  if (result.outcome !== "error") throw new Error("narrowing");
  assert.equal(result.errorKind, "auth");
  assert.equal(result.attemptsMade, 1);
  assert.equal(retryCalls.length, 0);
});

// ---------------------------------------------------------------------------
// maxRetries=0 (no retry allowed)
// ---------------------------------------------------------------------------

test("runner: maxRetries=0 never retries; first failure is terminal", async () => {
  fake.queue.push(retryableError("rate_limit"));
  const retryCalls: unknown[] = [];
  const result = await runAiRequest(
    fake,
    [{ role: "user", content: "hi" }],
    { ...BASE_OPTS, maxRetries: 0 },
    (i) => retryCalls.push(i),
  );
  assert.equal(result.outcome, "error");
  assert.equal(retryCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Unconfigured provider (facade responsibility — runner called after check)
// ---------------------------------------------------------------------------

test("runner: unconfigured provider chat returns error outcome", async () => {
  fake.configured = false;
  // Provider queue returns a graceful error (as a real unconfigured provider would).
  fake.queue.push({ ok: false, durationMs: 0, error: { kind: "unconfigured", retryable: false, message: "not configured" } });
  const result = await runAiRequest(fake, [{ role: "user", content: "hi" }], { ...BASE_OPTS, maxRetries: 0 });
  assert.equal(result.outcome, "error");
  if (result.outcome !== "error") throw new Error("narrowing");
  assert.equal(result.errorKind, "unconfigured");
});
