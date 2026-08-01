process.env.LOG_LEVEL = "error"; // keep test output quiet (sink logs at error)

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  captureError,
  fingerprint,
  scrubContext,
  setErrorSink,
  setAlertHook,
  resetErrorReporting,
  type CapturedError,
} from "@/lib/observability/errors";
import { getMetricsSnapshot, resetMetrics } from "@/lib/metrics";
import { runWithRequestContext } from "@/lib/observability/logger";

function counterValue(name: string, labels: Record<string, string>): number {
  const point = getMetricsSnapshot().counters.find((candidate) => {
    if (candidate.name !== name) return false;
    return Object.entries(labels).every(([key, value]) => candidate.labels[key] === value);
  });
  return point?.value ?? 0;
}

const restores: Array<() => void> = [];

beforeEach(() => {
  resetMetrics();
  resetErrorReporting();
  delete process.env.ERROR_ALERT_THRESHOLD;
});

afterEach(() => {
  while (restores.length) restores.pop()!();
});

test("captureError produces a grouped record with fingerprint + context", () => {
  const captured: CapturedError[] = [];
  restores.push(setErrorSink((r) => captured.push(r)));

  const record = runWithRequestContext({ requestId: "req-123", userId: "user-9", path: "/api/x" }, () =>
    captureError(new Error("kaboom"), {
      source: "server",
      machineReason: "test_failure",
    }),
  );

  assert.equal(record.name, "Error");
  assert.equal(record.message, "test_failure");
  assert.ok(record.fingerprint.startsWith("Error|test_failure"));
  assert.equal(record.source, "server");
  assert.equal(record.requestId, "req-123");
  assert.equal(record.userId, "user-9");
  assert.equal(record.route, "/api/x");
  assert.equal(record.environment, process.env.NODE_ENV ?? "development");
  assert.ok(typeof record.release === "string" && record.release.length > 0);
  // Sink received the same record.
  assert.equal(captured.length, 1);
  assert.equal(captured[0].fingerprint, record.fingerprint);
});

test("captureError never exposes unclassified exception prose", () => {
  const captured: CapturedError[] = [];
  restores.push(setErrorSink((record) => captured.push(record)));

  const privateProse = "ordinary private article sentence from a provider";
  const record = captureError(new Error(privateProse), { source: "server" });

  assert.equal(record.message, "unexpected_error");
  assert.doesNotMatch(record.fingerprint, /ordinary private article sentence/);
  assert.doesNotMatch(record.stack ?? "", /ordinary private article sentence/);
  assert.doesNotMatch(JSON.stringify(captured), /ordinary private article sentence/);
});

test("captureError preserves an explicitly controlled machine reason", () => {
  const record = captureError(new Error("private provider response"), {
    source: "worker",
    machineReason: "provider_failure",
  });
  assert.equal(record.message, "provider_failure");
  assert.doesNotMatch(record.stack ?? "", /private provider response/);
});

test("captureError rejects unbounded or prose-like machine reasons", () => {
  const privateProse = "ordinary private article sentence";
  for (const machineReason of [privateProse, `x${"a".repeat(80)}`, "UPPER_CASE"]) {
    const record = captureError(new Error("provider response"), {
      source: "server",
      machineReason,
    });
    assert.equal(record.message, "unexpected_error");
    assert.doesNotMatch(JSON.stringify(record), /ordinary private article sentence/);
  }
});

test("errors with varying ids/numbers collapse to one fingerprint", () => {
  const a = fingerprint({ name: "Error", message: "article abc12345 failed at attempt 3" });
  const b = fingerprint({ name: "Error", message: "article def67890 failed at attempt 9" });
  assert.equal(a, b);
});

test("captureError redacts content and scrubs PII/secret-looking context", () => {
  const captured: CapturedError[] = [];
  restores.push(setErrorSink((r) => captured.push(r)));

  captureError(new Error("failure for user me@example.com token ABCDEF0123456789ABCDEF0123456"), {
    source: "server",
    machineReason: "provider_failure",
    extra: {
      articleContent: "the full article body that must never be logged",
      prompt: "system prompt text",
      selectedText: "highlighted sentence",
      apiKey: "supersecretkey",
      authorization: "Bearer xyz",
      nested: { deep: "value" },
      safeField: "totally fine",
      count: 7,
    },
  });

  const record = captured[0];
  assert.equal(record.message, "provider_failure");
  assert.doesNotMatch(JSON.stringify(record), /me@example\.com|ABCDEF0123456789/);
  // Content + secret keys redacted; nested object replaced; safe fields kept.
  assert.equal(record.extra?.articleContent, "[redacted]");
  assert.equal(record.extra?.prompt, "[redacted]");
  assert.equal(record.extra?.selectedText, "[redacted]");
  assert.equal(record.extra?.apiKey, "[redacted]");
  assert.equal(record.extra?.authorization, "[redacted]");
  assert.equal(record.extra?.nested, "[object]");
  assert.equal(record.extra?.safeField, "totally fine");
  assert.equal(record.extra?.count, 7);
});

test("scrubContext masks emails/tokens and caps string length", () => {
  // Spaces keep each word < 24 chars so the token regex doesn't collapse it,
  // letting us verify the 200-char cap.
  const long = "ab ".repeat(200);
  const out = scrubContext({ note: long, who: "a@b.com" });
  assert.equal((out?.note as string).length, 200);
  assert.equal(out?.who, "[email]");
});

test("captureError increments the readwise_errors_captured_total metric", () => {
  restores.push(setErrorSink(() => {})); // quiet sink
  captureError(new Error("one"), { source: "server", severity: "error" });
  captureError(new Error("two"), { source: "server", severity: "error" });
  assert.equal(
    counterValue("readwise_errors_captured_total", {
      source: "server",
      severity: "error",
      alert: "false",
    }),
    2,
  );
});

test("alert hook fires once a fingerprint crosses the threshold", () => {
  process.env.ERROR_ALERT_THRESHOLD = "3";
  const alerts: CapturedError[] = [];
  restores.push(setErrorSink(() => {}));
  restores.push(setAlertHook((r) => alerts.push(r)));

  // Same fingerprint 3 times — alert fires on the 3rd occurrence.
  captureError(new Error("repeat me"), { source: "server" });
  captureError(new Error("repeat me"), { source: "server" });
  assert.equal(alerts.length, 0);
  const third = captureError(new Error("repeat me"), { source: "server" });
  assert.equal(third.alert, true);
  assert.equal(third.occurrences, 3);
  assert.equal(alerts.length, 1);
  // The alert occurrence is reflected in the metric label.
  assert.equal(
    counterValue("readwise_errors_captured_total", {
      source: "server",
      severity: "error",
      alert: "true",
    }),
    1,
  );
});

test("fatal severity always alerts regardless of frequency", () => {
  const alerts: CapturedError[] = [];
  restores.push(setErrorSink(() => {}));
  restores.push(setAlertHook((r) => alerts.push(r)));
  const record = captureError(new Error("fatal once"), { source: "worker", severity: "fatal" });
  assert.equal(record.alert, true);
  assert.equal(alerts.length, 1);
});

test("captureError tolerates throwing sinks and alert hooks", () => {
  restores.push(setErrorSink(() => {
    throw new Error("sink unavailable");
  }));
  restores.push(setAlertHook(() => {
    throw new Error("alert unavailable");
  }));

  assert.doesNotThrow(() => captureError(new Error("best effort hooks"), { source: "worker", severity: "fatal" }));
});

test("default sink does not throw without a provider configured", () => {
  // No setErrorSink override here — exercise the real default (structured log).
  assert.doesNotThrow(() => captureError(new Error("default path"), { source: "client" }));
});

test("captureError tolerates non-Error throwables", () => {
  restores.push(setErrorSink(() => {}));
  const record = captureError("a plain string failure", { source: "server" });
  assert.equal(record.message, "unexpected_error");
  assert.ok(record.fingerprint.length > 0);
});
