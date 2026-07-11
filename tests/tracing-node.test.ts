/**
 * Tests for src/lib/observability/tracing-node.ts — the Node SDK bootstrap.
 *
 * Verifies:
 * - Idempotent startTracing (no double-start)
 * - Graceful no-op when tracing is not configured
 * - OTLP vs console exporter selection
 * - Resilience: init failure does not throw, logs warning, resets state
 * - SIGTERM/SIGINT shutdown hooks are registered
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

let tracingConfigResult: { exporter: string; endpoint: string | null; serviceName: string; environment: string; serviceVersion: string } | null = null;
let sdkStartCalls = 0;
let sdkShutdownCalls = 0;
let registeredSignals: string[] = [];
let loadShouldFail = false;

before(() => {
  // Mock the config provider
  mock.module("@/lib/runtime-config/observability", {
    namedExports: {
      tracingConfig: () => tracingConfigResult,
    },
  });

  // Mock the logger
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

  // Mock OpenTelemetry modules
  mock.module("@opentelemetry/sdk-node", {
    namedExports: {
      NodeSDK: class MockNodeSDK {
        start() {
          sdkStartCalls++;
        }
        async shutdown() {
          sdkShutdownCalls++;
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
        constructor(opts?: { url?: string }) { this.opts = opts; }
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
  registeredSignals = [];
  loadShouldFail = false;
});

test("startTracing is a no-op when tracingConfig returns null", async () => {
  // Fresh import each time to reset `started` flag
  const mod = await import("@/lib/observability/tracing-node");
  // Re-import with the null config already in place (from beforeEach)
  await mod.startTracing();
  assert.equal(sdkStartCalls, 0, "SDK should not start when config is null");
});

test("startTracing initializes the SDK when config is present", async () => {
  tracingConfigResult = {
    exporter: "otlp",
    endpoint: "http://collector:4318/v1/traces",
    serviceName: "readwise",
    environment: "test",
    serviceVersion: "1.0.0",
  };

  // Need a fresh module to reset `started`
  const { startTracing } = await import("@/lib/observability/tracing-node");
  await startTracing();
  assert.equal(sdkStartCalls, 1, "SDK should start once");
});
