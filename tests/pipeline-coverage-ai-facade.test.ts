process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

let retryReasons: string[] = [];
let ledgerStatuses: string[] = [];
let callOutcomes: string[] = [];
let backgroundAllowed = true;
let runnerOutcome: Record<string, unknown> = { outcome: "aborted", durationMs: 12 };

before(() => {
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => ({ warn() {}, info() {}, error() {}, debug() {} }),
    },
  });
  mock.module("@/lib/runtime-config/ai", {
    namedExports: {
      aiMaxRetries: () => 2,
      aiTimeoutMs: () => 50,
    },
  });
  mock.module("@/lib/runtime-config/feature-flags", {
    namedExports: {
      isAiFeatureEnabled: () => true,
    },
  });
  mock.module("@/lib/metrics", {
    namedExports: {
      recordAiCall: (input: { outcome: string }) => callOutcomes.push(input.outcome),
      recordAiRetry: (input: { reason: string }) => retryReasons.push(input.reason),
    },
  });
  mock.module("@/lib/observability/tracing", {
    namedExports: {
      withSpan: async (_name: string, _attrs: unknown, fn: (span: unknown) => Promise<unknown>) => fn({}),
      setSpanAttributes: () => {},
    },
  });
  mock.module("@/lib/ai/ledger", {
    namedExports: {
      recordAiInvocation: async (input: { status: string }) => {
        ledgerStatuses.push(input.status);
      },
    },
  });
  mock.module("@/lib/ai/budget", {
    namedExports: {
      getAiContext: () => null,
      assertAiQuota: async () => {},
      checkAiBudget: async () =>
        backgroundAllowed
          ? { allowed: true }
          : { allowed: false, scope: "feature", limit: 1, used: 1 },
    },
  });
  mock.module("@/lib/ai/registry", {
    namedExports: {
      getAiProvider: () => ({
        isConfigured: () => true,
        modelName: () => "loop2-model",
        capabilities: () => ({ contextWindowTokens: 8000, maxOutputTokens: 512 }),
      }),
    },
  });
  mock.module("@/lib/ai/runner", {
    namedExports: {
      runAiRequest: async (
        _provider: unknown,
        _messages: unknown,
        _options: unknown,
        onRetry: (retry: { reason: string; model: string; attempt: number; delayMs: number }) => void,
      ) => {
        onRetry({ reason: "timeout", model: "loop2-model", attempt: 1, delayMs: 0 });
        onRetry({ reason: "network", model: "loop2-model", attempt: 2, delayMs: 0 });
        return runnerOutcome;
      },
    },
  });
});

beforeEach(() => {
  retryReasons = [];
  ledgerStatuses = [];
  callOutcomes = [];
  backgroundAllowed = true;
  runnerOutcome = { outcome: "aborted", durationMs: 12 };
});

test("chatCompleteWithMeta records aborted calls and retry reason fallbacks", async () => {
  const { chatCompleteWithMeta } = await import("@/lib/ai/facade");

  assert.equal(
    await chatCompleteWithMeta([{ role: "user", content: "hello" }], { feature: "loop2" }),
    null,
  );
  assert.deepEqual(retryReasons, ["timeout", "network"]);
  assert.deepEqual(callOutcomes, ["aborted"]);
  assert.deepEqual(ledgerStatuses, ["aborted"]);
});

test("chatCompleteWithMeta skips disallowed background quota without provider calls", async () => {
  const { chatCompleteWithMeta } = await import("@/lib/ai/facade");
  backgroundAllowed = false;

  assert.equal(
    await chatCompleteWithMeta([{ role: "user", content: "hello" }], {
      feature: "loop2",
      kind: "background",
      userId: "user-1",
    }),
    null,
  );
  assert.deepEqual(retryReasons, []);
  assert.deepEqual(callOutcomes, []);
  assert.deepEqual(ledgerStatuses, ["fallback"]);
});
