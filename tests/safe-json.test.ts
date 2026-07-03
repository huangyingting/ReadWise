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

import { __safeJsonTest, safeJsonStringify } from "@/lib/safe-json";

function assertEscapesUnsafeChar(value: string, rawChar: string, escapedChar: string) {
  const result = safeJsonStringify({ x: value });
  assert.ok(!result.includes(rawChar), `raw '${rawChar}' found in: ${result}`);
  assert.ok(result.includes(escapedChar), `expected ${escapedChar} in: ${result}`);
}

describe("safeJsonStringify — XSS escaping", () => {
  test("escapes < to prevent </script> injection", () => {
    assertEscapesUnsafeChar("</script><script>alert(1)</script>", "<", "\\u003c");
  });

  test("escapes > to prevent tag close", () => {
    assertEscapesUnsafeChar("a>b", ">", "\\u003e");
  });

  test("escapes & to prevent HTML entity injection", () => {
    assertEscapesUnsafeChar("a&b", "&", "\\u0026");
  });

  test("escapes U+2028 LINE SEPARATOR (breaks inline JS)", () => {
    assertEscapesUnsafeChar("a\u2028b", "\u2028", "\\u2028");
  });

  test("escapes U+2029 PARAGRAPH SEPARATOR (breaks inline JS)", () => {
    assertEscapesUnsafeChar("a\u2029b", "\u2029", "\\u2029");
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

  test("leaves non-mapped replacement characters unchanged", () => {
    assert.strictEqual(__safeJsonTest.escapeJsonChar("x"), "x");
  });
});
