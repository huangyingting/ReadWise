// No LOG_LEVEL suppression here — the tests capture console output directly.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---- helpers -------------------------------------------------------------

/** Capture all console.log / console.warn / console.error output within `fn`. */
async function captureConsole(fn: () => Promise<void> | void): Promise<string[]> {
  const lines: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args: unknown[]) => lines.push(String(args[0]));
  console.warn = (...args: unknown[]) => lines.push(String(args[0]));
  console.error = (...args: unknown[]) => lines.push(String(args[0]));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
  return lines;
}

beforeEach(() => {
  // Reset LOG_LEVEL to a known default before each test.
  process.env.LOG_LEVEL = "info";
});

// ---- runWithRequestContext / getRequestId / getRequestContext ------------

test("runWithRequestContext binds requestId for getRequestId inside fn", async () => {
  const { runWithRequestContext, getRequestId } = await import("@/lib/observability/logger");
  let captured: string | undefined;
  runWithRequestContext({ requestId: "req-abc-123" }, () => {
    captured = getRequestId();
  });
  assert.equal(captured, "req-abc-123");
});

test("getRequestId returns undefined outside a request context", async () => {
  const { getRequestId } = await import("@/lib/observability/logger");
  // Outside runWithRequestContext there is no ambient context.
  const id = getRequestId();
  assert.equal(id, undefined);
});

test("runWithRequestContext binds full context for getRequestContext", async () => {
  const { runWithRequestContext, getRequestContext } = await import("@/lib/observability/logger");
  let captured: ReturnType<typeof getRequestContext>;
  runWithRequestContext(
    { requestId: "req-xyz", userId: "user-42", method: "GET", path: "/api/foo" },
    () => {
      captured = getRequestContext();
    },
  );
  assert.deepEqual(captured, {
    requestId: "req-xyz",
    userId: "user-42",
    method: "GET",
    path: "/api/foo",
  });
});

test("getRequestContext returns undefined outside a request context", async () => {
  const { getRequestContext } = await import("@/lib/observability/logger");
  assert.equal(getRequestContext(), undefined);
});

// ---- setRequestContext ---------------------------------------------------

test("setRequestContext mutates userId within an active scope", async () => {
  const { runWithRequestContext, setRequestContext, getRequestContext } = await import("@/lib/observability/logger");
  let afterSet: ReturnType<typeof getRequestContext>;
  runWithRequestContext({ requestId: "req-set-1" }, () => {
    setRequestContext({ userId: "user-99" });
    afterSet = getRequestContext();
  });
  assert.equal(afterSet?.requestId, "req-set-1");
  assert.equal(afterSet?.userId, "user-99");
});

test("setRequestContext is a no-op outside a request scope", async () => {
  const { setRequestContext, getRequestContext } = await import("@/lib/observability/logger");
  // Should not throw; no ambient store to mutate.
  assert.doesNotThrow(() => setRequestContext({ userId: "should-not-stick" }));
  assert.equal(getRequestContext(), undefined);
});

// ---- createLogger auto-merges ambient context ----------------------------

test("createLogger auto-merges requestId and userId into log lines", async () => {
  process.env.LOG_LEVEL = "info";
  const { runWithRequestContext, createLogger } = await import("@/lib/observability/logger");
  const lines = await captureConsole(() => {
    runWithRequestContext({ requestId: "req-merge-1", userId: "u-77" }, () => {
      const log = createLogger("test-scope");
      log.info("hello from context");
    });
  });
  assert.ok(lines.length >= 1, "expected at least one log line");
  const parsed = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  assert.equal(parsed.requestId, "req-merge-1");
  assert.equal(parsed.userId, "u-77");
  assert.equal(parsed.scope, "test-scope");
  assert.equal(parsed.message, "hello from context");
  assert.equal(parsed.level, "info");
});

test("createLogger includes base fields in every line", async () => {
  process.env.LOG_LEVEL = "info";
  const { createLogger } = await import("@/lib/observability/logger");
  const lines = await captureConsole(() => {
    const log = createLogger("worker", { component: "processor" });
    log.info("processing");
  });
  const parsed = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  assert.equal(parsed.component, "processor");
  assert.equal(parsed.scope, "worker");
});

test("createLogger merges per-call meta on top of base and context", async () => {
  process.env.LOG_LEVEL = "info";
  const { runWithRequestContext, createLogger } = await import("@/lib/observability/logger");
  const lines = await captureConsole(() => {
    runWithRequestContext({ requestId: "req-meta" }, () => {
      const log = createLogger("api", { base: "yes" });
      log.info("with meta", { extra: "value" });
    });
  });
  const parsed = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  assert.equal(parsed.requestId, "req-meta");
  assert.equal(parsed.base, "yes");
  assert.equal(parsed.extra, "value");
});

// ---- LOG_LEVEL filtering -------------------------------------------------

test("LOG_LEVEL=warn drops debug and info lines", async () => {
  process.env.LOG_LEVEL = "warn";
  const { createLogger } = await import("@/lib/observability/logger");
  const lines = await captureConsole(() => {
    const log = createLogger("filter-test");
    log.debug("debug-msg");
    log.info("info-msg");
    log.warn("warn-msg");
    log.error("error-msg");
  });
  assert.equal(lines.length, 2, "only warn + error should pass");
  const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.equal(parsed[0].level, "warn");
  assert.equal(parsed[0].message, "warn-msg");
  assert.equal(parsed[1].level, "error");
  assert.equal(parsed[1].message, "error-msg");
});

test("LOG_LEVEL=error drops debug, info, and warn lines", async () => {
  process.env.LOG_LEVEL = "error";
  const { createLogger } = await import("@/lib/observability/logger");
  const lines = await captureConsole(() => {
    const log = createLogger("filter-error-test");
    log.debug("debug");
    log.info("info");
    log.warn("warn");
    log.error("error-only");
  });
  assert.equal(lines.length, 1, "only error should pass");
  const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(parsed.level, "error");
  assert.equal(parsed.message, "error-only");
});

test("LOG_LEVEL=debug emits all levels", async () => {
  process.env.LOG_LEVEL = "debug";
  const { createLogger } = await import("@/lib/observability/logger");
  const lines = await captureConsole(() => {
    const log = createLogger("all-levels");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
  });
  assert.equal(lines.length, 4, "all four levels should be emitted");
});

test("LOG_LEVEL=info drops only debug", async () => {
  process.env.LOG_LEVEL = "info";
  const { createLogger } = await import("@/lib/observability/logger");
  const lines = await captureConsole(() => {
    const log = createLogger("info-test");
    log.debug("dropped");
    log.info("kept-info");
    log.warn("kept-warn");
    log.error("kept-error");
  });
  assert.equal(lines.length, 3);
  const levels = lines.map((l) => (JSON.parse(l) as Record<string, unknown>).level);
  assert.deepEqual(levels, ["info", "warn", "error"]);
});

// ---- log line structure --------------------------------------------------

test("log lines contain ts, level, scope, message fields", async () => {
  process.env.LOG_LEVEL = "info";
  const { createLogger } = await import("@/lib/observability/logger");
  const lines = await captureConsole(() => {
    createLogger("struct-test").info("structure check");
  });
  const parsed = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  assert.ok(typeof parsed.ts === "string", "ts must be a string");
  assert.ok(typeof parsed.level === "string", "level must be a string");
  assert.ok(typeof parsed.scope === "string", "scope must be a string");
  assert.ok(typeof parsed.message === "string", "message must be a string");
});
