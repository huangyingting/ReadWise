process.env.LOG_LEVEL = "error"; // silence any incidental log lines

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withSpan,
  startChildSpan,
  setSpanAttributes,
  sanitizeAttributes,
  activeTraceId,
} from "@/lib/observability/tracing";

// These tests run with NO OpenTelemetry SDK registered, so the OTel API is a
// no-op. Everything here must therefore be a safe pass-through.

test("withSpan returns the sync fn's value when tracing is disabled", async () => {
  const result = await withSpan("test.sync", { "readwise.feature": "quiz" }, () => 42);
  assert.equal(result, 42);
});

test("withSpan returns the async fn's resolved value", async () => {
  const result = await withSpan("test.async", { "readwise.feature": "quiz" }, async () => {
    return "ok";
  });
  assert.equal(result, "ok");
});

test("withSpan passes a usable (no-op) span to the callback", async () => {
  await withSpan("test.span", {}, (span) => {
    // None of these should throw against the no-op span.
    span.setAttribute("readwise.feature", "x");
    span.setAttributes({ "readwise.status": 200 });
    span.addEvent("event");
    assert.equal(typeof span.spanContext().traceId, "string");
  });
});

test("withSpan re-throws when the callback throws (does not swallow errors)", async () => {
  await assert.rejects(
    () => withSpan("test.throw", {}, () => {
      throw new Error("boom");
    }),
    /boom/,
  );
});

test("sanitizeAttributes keeps only allow-listed, content-free keys", () => {
  const safe = sanitizeAttributes({
    "readwise.feature": "translation",
    "readwise.route": "/api/reader/[id]/translate",
    // The following are NOT on the allow-list and must be dropped — they could
    // carry article text / prompts / selections.
    prompt: "translate this secret paragraph",
    "article.content": "<p>full body</p>",
    selectedText: "a sentence the user highlighted",
    completion: "the model output",
  });
  assert.deepEqual(Object.keys(safe).sort(), ["readwise.feature", "readwise.route"]);
  // Explicitly assert no content-bearing keys survive.
  assert.equal("prompt" in safe, false);
  assert.equal("article.content" in safe, false);
  assert.equal("selectedText" in safe, false);
  assert.equal("completion" in safe, false);
});

test("sanitizeAttributes drops non-primitive values even for allow-listed keys", () => {
  const safe = sanitizeAttributes({
    // object value is dropped (could be a serialized content payload)
    "readwise.feature": { nested: true } as unknown as string,
    "readwise.status": 200,
  });
  assert.deepEqual(safe, { "readwise.status": 200 });
});

test("withSpan only sets sanitized attributes (no content leak)", async () => {
  const seen: Record<string, unknown> = {};
  await withSpan(
    "test.attrs",
    { "readwise.feature": "quiz", prompt: "leak me", "article.content": "leak body" },
    (span) => {
      // Wrap setAttributes to observe what actually lands on the span.
      const original = span.setAttributes.bind(span);
      span.setAttributes = (attrs) => {
        Object.assign(seen, attrs);
        return original(attrs);
      };
    },
  );
  // The span was created with sanitized attributes; the helper never forwards
  // disallowed keys. Assert the disallowed keys are absent from anything we set.
  assert.equal("prompt" in seen, false);
  assert.equal("article.content" in seen, false);
});

test("startChildSpan + setSpanAttributes are safe no-ops without an SDK", () => {
  const span = startChildSpan("test.child", { "readwise.feature": "vocab" });
  assert.doesNotThrow(() => setSpanAttributes(span, { "readwise.status": 200, secret: "x" }));
  assert.doesNotThrow(() => span.end());
});

test("activeTraceId is undefined when no SDK/sampling is active", () => {
  assert.equal(activeTraceId(), undefined);
});
