import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  HIGHLIGHT_COLOR_OPTIONS,
  HIGHLIGHT_COLORS,
  getHighlightColorCssVar,
  getHighlightColorLabel,
  isHighlightColor,
} from "@/components/ui/highlight-colors";

describe("highlight color swatch metadata", () => {
  test("keeps UI swatches aligned with supported annotation colors", () => {
    assert.deepEqual(
      HIGHLIGHT_COLOR_OPTIONS.map((option) => option.color),
      [...HIGHLIGHT_COLORS],
    );
    assert.deepEqual(
      HIGHLIGHT_COLOR_OPTIONS.map((option) => option.label),
      ["Yellow", "Green", "Blue", "Pink"],
    );
  });

  test("resolves fill and dot design tokens for each highlight color", () => {
    for (const color of HIGHLIGHT_COLORS) {
      assert.equal(getHighlightColorCssVar(color), `var(--hl-${color})`);
      assert.equal(getHighlightColorCssVar(color, "dot"), `var(--hl-dot-${color})`);
      assert.equal(
        getHighlightColorLabel(color),
        HIGHLIGHT_COLOR_OPTIONS.find((option) => option.color === color)?.label,
      );
    }
  });

  test("guards unknown persisted color values", () => {
    assert.equal(isHighlightColor("yellow"), true);
    assert.equal(isHighlightColor("purple"), false);
    assert.equal(isHighlightColor(null), false);
  });
});
