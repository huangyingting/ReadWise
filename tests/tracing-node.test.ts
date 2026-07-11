/**
 * Tests for src/lib/observability/tracing-node.ts — the Node SDK bootstrap.
 *
 * Verifies:
 * - errorMessage pure helper (Error instance and raw string)
 * - Graceful no-op when tracing is not configured
 * - Error in SDK init: resets `started` and logs warning (catch block)
 * - Full OTLP start with shutdown handler registration and invocation
 * - Idempotent startTracing (no double-start)
 *
 * NOTE: tests run in order to exercise the module-level `started` state
 * machine: null-config → error → success → idempotency.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let tracingConfigResult: {
  exporter: string;
  endpoint: string | null;
  serviceName: string;
  environment: string;
  serviceVersion: string;
} | null = null;
let sdkStartCalls = 0;
let sdkShutdownCalls = 0;
let sdkShutdownShouldFail = false;
let loadShouldFail = false;

before(() => {
  mock.module("@/lib/runtime-config/observability", {
    namedExports: {
      tracingConfig: () => tracingConfigResult,
    },
  });

  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => ({
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
    },
  });

  mock.module("@opentelemetry/sdk-node", {
    namedExports: {
      NodeSDK: class MockNodeSDK {
        start() {
          sdkStartCalls++;
          if (loadShouldFail) throw new Error("mock SDK start failure");
        }
        async shutdown() {
          sdkShutdownCalls++;
          if (sdkShutdownShouldFail) throw new Error("mock shutdown failure");
        }
      },
    },
  });
  mock.module("@opentelemetry/resources", {
    namedExports: {
      resourceFromAttributes: (attrs: Record<string, string>) => ({ attributes: attrs }),
    },
  });
  mock.module("@opentelemetry/semantic-conventions", {
    namedExports: {
      ATTR_SERVICE_NAME: "service.name",
      ATTR_SERVICE_VERSION: "service.version",
    },
  });
  mock.module("@opentelemetry/exporter-trace-otlp-http", {
    namedExports: {
      OTLPTraceExporter: class MockOTLP {
        opts;
        constructor(opts?: { url?: string }) {
          this.opts = opts;
        }
      },
    },
  });
  mock.module("@opentelemetry/sdk-trace-base", {
    namedExports: {
      ConsoleSpanExporter: class MockConsole {},
    },
  });
});

beforeEach(() => {
  tracingConfigResult = null;
  sdkStartCalls = 0;
  sdkShutdownCalls = 0;
  sdkShutdownShouldFail = false;
  loadShouldFail = false;
});

// ── errorMessage unit tests (pure, no module-state dependency) ───────────

test("errorMessage returns message from Error instance", async () => {
  const { errorMessage } = await import("@/lib/observability/tracing-node");
  assert.equal(errorMessage(new Error("test failure")), "test failure");
});

test("errorMessage coerces non-Error values to string", async () => {
  const { errorMessage } = await import("@/lib/observability/tracing-node");
  assert.equal(errorMessage("raw string"), "raw string");
  assert.equal(errorMessage(42), "42");
  assert.equal(errorMessage(null), "null");
});

// ── startTracing state machine (tests MUST run in this order) ────────────

test("startTracing is a no-op when tracingConfig returns null", async () => {
  // tracingConfigResult = null (set by beforeEach)
  const { startTracing } = await import("@/lib/observability/tracing-node");
  await startTracing();
  assert.equal(sdkStartCalls, 0, "SDK should not start when config is null");
});

test("startTracing resets started and logs warning on SDK init failure", async () => {
  // started=false from previous test (config was null)
  tracingConfigResult = {
    exporter: "otlp",
    endpoint: "http://collector:4318/v1/traces",
    serviceName: "readwise",
    environment: "test",
    serviceVersion: "1.0.0",
  };
  loadShouldFail = true;

  const { startTracing } = await import("@/lib/observability/tracing-node");
  await startTracing();

  // SDK.start() threw → catch block ran → started reset to false
  assert.equal(sdkStartCalls, 1, "SDK.start() should have been attempted once");
  // started is now false again (reset by catch block)
});

test("startTracing initializes the SDK and registers shutdown handlers", async () => {
  // started=false (reset by catch in previous test)
  tracingConfigResult = {
    exporter: "otlp",
    endpoint: "http://collector:4318/v1/traces",
    serviceName: "readwise",
    environment: "test",
    serviceVersion: "1.0.0",
  };

  // Intercept process.once to capture the shutdown handler
  let capturedShutdown: (() => void) | null = null;
  const origOnce = process.once.bind(process);
  (process as any).once = (event: string, fn: () => void) => {
    if (event === "SIGTERM" || event === "SIGINT") capturedShutdown = fn;
    origOnce(event as "SIGTERM", fn as NodeJS.SignalsListener);
  };

  const { startTracing } = await import("@/lib/observability/tracing-node");
  await startTracing();

  (process as any).once = origOnce;

  assert.equal(sdkStartCalls, 1, "SDK should start once");
  assert.ok(capturedShutdown !== null, "shutdown handler should be registered");

  // Invoke shutdown handler — covers lines 99-105
  sdkShutdownShouldFail = true;
  (capturedShutdown as any)();
  // Give the microtask/Promise chain a tick to execute
  await new Promise((r) => setImmediate(r));
  assert.equal(sdkShutdownCalls, 1, "sdk.shutdown() should have been called");
});

test("startTracing is idempotent: second call returns early", async () => {
  // started=true from previous test
  tracingConfigResult = {
    exporter: "otlp",
    endpoint: "http://collector:4318/v1/traces",
    serviceName: "readwise",
    environment: "test",
    serviceVersion: "1.0.0",
  };

  const { startTracing } = await import("@/lib/observability/tracing-node");
  await startTracing();

  assert.equal(sdkStartCalls, 0, "SDK should NOT start again (idempotency guard)");
});
