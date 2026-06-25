import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateListName,
  LIST_NAME_MAX_LENGTH,
} from "@/lib/list-name-validation";

describe("validateListName", () => {
  test("returns error for empty string", () => {
    assert.strictEqual(validateListName(""), "Name is required");
  });

  test("returns error for whitespace-only string", () => {
    assert.strictEqual(validateListName("   "), "Name is required");
  });

  test("returns null for a valid name", () => {
    assert.strictEqual(validateListName("My Reading List"), null);
  });

  test("returns null for name at the max length", () => {
    const atMax = "a".repeat(LIST_NAME_MAX_LENGTH);
    assert.strictEqual(validateListName(atMax), null);
  });

  test("returns error for name exceeding max length", () => {
    const overMax = "a".repeat(LIST_NAME_MAX_LENGTH + 1);
    const result = validateListName(overMax);
    assert.ok(result !== null, "Expected error for overlong name");
    assert.ok(
      result.includes(String(LIST_NAME_MAX_LENGTH)),
      "Error message should mention the max length",
    );
  });

  test("trims leading/trailing whitespace before checking length", () => {
    // "  a  " trims to "a" (length 1) — valid even though raw length > 1
    assert.strictEqual(validateListName("  valid  "), null);
  });
});
