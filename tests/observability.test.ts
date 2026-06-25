/**
 * Smoke tests for the observability package barrel (REF-053).
 *
 * Verifies that the `@/lib/observability` barrel re-exports every public symbol
 * expected from the package surface, and that the compatibility shims at the
 * old paths still resolve to the same runtime values (not duplicates).
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";

test("observability barrel exports all logger symbols", async () => {
  const pkg = await import("@/lib/observability");
  assert.equal(typeof pkg.createLogger, "function");
  assert.equal(typeof pkg.runWithRequestContext, "function");
  assert.equal(typeof pkg.getRequestContext, "function");
  assert.equal(typeof pkg.getRequestId, "function");
  assert.equal(typeof pkg.setRequestContext, "function");
});

test("observability barrel exports all error-capture symbols", async () => {
  const pkg = await import("@/lib/observability");
  assert.equal(typeof pkg.captureError, "function");
  assert.equal(typeof pkg.fingerprint, "function");
  assert.equal(typeof pkg.scrubContext, "function");
  assert.equal(typeof pkg.setErrorSink, "function");
  assert.equal(typeof pkg.setAlertHook, "function");
  assert.equal(typeof pkg.resetErrorReporting, "function");
});

test("observability barrel exports all tracing symbols", async () => {
  const pkg = await import("@/lib/observability");
  assert.equal(typeof pkg.withSpan, "function");
  assert.equal(typeof pkg.startChildSpan, "function");
  assert.equal(typeof pkg.setSpanAttributes, "function");
  assert.equal(typeof pkg.sanitizeAttributes, "function");
  assert.equal(typeof pkg.recordSpanError, "function");
  assert.equal(typeof pkg.activeTraceId, "function");
  assert.equal(typeof pkg.TRACER_NAME, "string");
});

test("observability barrel exports SLO catalog and evaluator", async () => {
  const pkg = await import("@/lib/observability");
  assert.ok(Array.isArray(pkg.SLI_CATALOG));
  assert.ok(pkg.SLI_CATALOG.length > 0);
  assert.equal(typeof pkg.evaluateSlos, "function");
});

test("@/lib/logger shim resolves to the same createLogger as observability package", async () => {
  const shim = await import("@/lib/logger");
  const pkg = await import("@/lib/observability/logger");
  // Both point to the same module singleton.
  assert.equal(shim.createLogger, pkg.createLogger);
  assert.equal(shim.runWithRequestContext, pkg.runWithRequestContext);
});

test("@/lib/error-reporting shim resolves to the same captureError as observability package", async () => {
  const shim = await import("@/lib/error-reporting");
  const pkg = await import("@/lib/observability/errors");
  assert.equal(shim.captureError, pkg.captureError);
  assert.equal(shim.fingerprint, pkg.fingerprint);
});

test("@/lib/tracing shim resolves to the same withSpan as observability package", async () => {
  const shim = await import("@/lib/tracing");
  const pkg = await import("@/lib/observability/tracing");
  assert.equal(shim.withSpan, pkg.withSpan);
  assert.equal(shim.sanitizeAttributes, pkg.sanitizeAttributes);
});

test("@/lib/slo shim resolves to the same SLI_CATALOG as observability package", async () => {
  const shim = await import("@/lib/slo");
  const pkg = await import("@/lib/observability/slo");
  assert.equal(shim.SLI_CATALOG, pkg.SLI_CATALOG);
  assert.equal(shim.evaluateSlos, pkg.evaluateSlos);
});

test("observability logger creates working structured logger via barrel", async () => {
  const { createLogger, runWithRequestContext, getRequestContext } = await import("@/lib/observability");
  let ctx: ReturnType<typeof getRequestContext>;
  runWithRequestContext({ requestId: "obs-test-1", userId: "u-obs" }, () => {
    ctx = getRequestContext();
    const log = createLogger("obs-test");
    // Should not throw.
    assert.doesNotThrow(() => log.info("barrel smoke test"));
  });
  assert.equal(ctx?.requestId, "obs-test-1");
  assert.equal(ctx?.userId, "u-obs");
});

test("observability captureError works end-to-end via barrel", async () => {
  const { captureError, setErrorSink, resetErrorReporting } = await import("@/lib/observability");
  resetErrorReporting();
  const captured: unknown[] = [];
  const restore = setErrorSink((r) => captured.push(r));
  try {
    captureError(new Error("barrel test error"), { source: "server" });
    assert.equal(captured.length, 1);
  } finally {
    restore();
  }
});

test("observability sanitizeAttributes drops disallowed keys via barrel", async () => {
  const { sanitizeAttributes } = await import("@/lib/observability");
  const result = sanitizeAttributes({
    "readwise.feature": "test",
    "article.content": "should be dropped",
    prompt: "also dropped",
  });
  assert.ok("readwise.feature" in result);
  assert.equal("article.content" in result, false);
  assert.equal("prompt" in result, false);
});
