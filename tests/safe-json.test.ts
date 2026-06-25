/**
 * Tests for safeJsonStringify — XSS-safe JSON for inline <script> injection
 * (REF-085, security-sensitive).
 *
 * JSON.stringify does NOT escape <, >, &, U+2028, or U+2029. A crafted string
 * containing these can break out of an inline <script> block. This helper
 * replaces them with their Unicode escape equivalents.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { safeJsonStringify } from "@/lib/safe-json";

describe("safeJsonStringify — XSS escaping", () => {
  test("escapes < to prevent </script> injection", () => {
    const result = safeJsonStringify({ x: "</script><script>alert(1)</script>" });
    assert.ok(!result.includes("<"), `raw '<' found in: ${result}`);
    assert.ok(result.includes("\\u003c"), `expected \\u003c in: ${result}`);
  });

  test("escapes > to prevent tag close", () => {
    const result = safeJsonStringify({ x: "a>b" });
    assert.ok(!result.includes(">"), `raw '>' found in: ${result}`);
    assert.ok(result.includes("\\u003e"), `expected \\u003e in: ${result}`);
  });

  test("escapes & to prevent HTML entity injection", () => {
    const result = safeJsonStringify({ x: "a&b" });
    assert.ok(!result.includes("&"), `raw '&' found in: ${result}`);
    assert.ok(result.includes("\\u0026"), `expected \\u0026 in: ${result}`);
  });

  test("escapes U+2028 LINE SEPARATOR (breaks inline JS)", () => {
    const result = safeJsonStringify({ x: "a\u2028b" });
    assert.ok(!result.includes("\u2028"), "raw U+2028 found in output");
    assert.ok(result.includes("\\u2028"), "expected \\u2028 escape");
  });

  test("escapes U+2029 PARAGRAPH SEPARATOR (breaks inline JS)", () => {
    const result = safeJsonStringify({ x: "a\u2029b" });
    assert.ok(!result.includes("\u2029"), "raw U+2029 found in output");
    assert.ok(result.includes("\\u2029"), "expected \\u2029 escape");
  });

  test("produces valid JSON after escaping", () => {
    const value = { title: "</script>", score: 42, nested: { ok: true } };
    const result = safeJsonStringify(value);
    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.title, "</script>");
    assert.strictEqual(parsed.score, 42);
    assert.strictEqual(parsed.nested.ok, true);
  });

  test("handles null", () => {
    assert.strictEqual(safeJsonStringify(null), "null");
  });

  test("handles a plain number", () => {
    assert.strictEqual(safeJsonStringify(42), "42");
  });

  test("handles a plain string without special chars unchanged", () => {
    const result = safeJsonStringify("hello world");
    assert.strictEqual(result, '"hello world"');
  });

  test("handles arrays", () => {
    const result = safeJsonStringify([1, "<b>", 3]);
    assert.ok(!result.includes("<"), "raw '<' found in array result");
    const parsed = JSON.parse(result);
    assert.deepStrictEqual(parsed, [1, "<b>", 3]);
  });
});
