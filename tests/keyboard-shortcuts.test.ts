/**
 * Tests for keyboard shortcut and focus interaction utilities (#515 — REF-078).
 *
 * These tests run in Node.js (no DOM), so they focus on the pure-logic helpers
 * that can be verified without a browser environment:
 *
 *  - isEditableTarget (use-keyboard-shortcut)
 *  - computeRovingIndex (use-roving-tabindex)
 *  - SHORTCUT_GROUPS registry metadata invariants (keyboard-shortcuts)
 *  - useFocusTrap / useKeyboardShortcut / useRovingTabindex export shapes
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isEditableTarget, useKeyboardShortcut } from "@/lib/use-keyboard-shortcut";
import { computeRovingIndex, useRovingTabindex } from "@/lib/use-roving-tabindex";
import { SHORTCUT_GROUPS } from "@/lib/keyboard-shortcuts";
import { getTabbable, useFocusTrap } from "@/lib/focus-trap";

// ---------------------------------------------------------------------------
// isEditableTarget — pure logic
// ---------------------------------------------------------------------------

describe("isEditableTarget", () => {
  test("returns false for null", () => {
    assert.equal(isEditableTarget(null), false);
  });

  test("returns false for a non-HTMLElement (EventTarget stub)", () => {
    const nonEl = {} as EventTarget;
    assert.equal(isEditableTarget(nonEl), false);
  });

  test("returns true for an INPUT element", () => {
    const el = { tagName: "INPUT", isContentEditable: false } as HTMLElement;
    assert.equal(isEditableTarget(el), true);
  });

  test("returns true for a TEXTAREA element", () => {
    const el = { tagName: "TEXTAREA", isContentEditable: false } as HTMLElement;
    assert.equal(isEditableTarget(el), true);
  });

  test("returns true for a contenteditable host", () => {
    const el = { tagName: "DIV", isContentEditable: true } as HTMLElement;
    assert.equal(isEditableTarget(el), true);
  });

  test("returns false for a BUTTON", () => {
    const el = { tagName: "BUTTON", isContentEditable: false } as HTMLElement;
    assert.equal(isEditableTarget(el), false);
  });

  test("returns false for a SPAN", () => {
    const el = { tagName: "SPAN", isContentEditable: false } as HTMLElement;
    assert.equal(isEditableTarget(el), false);
  });

  test("global shortcut suppression — INPUT is blocked", () => {
    const input = { tagName: "INPUT", isContentEditable: false } as HTMLElement;
    assert.equal(isEditableTarget(input), true, "shortcut should be suppressed in INPUT");
  });

  test("global shortcut suppression — BODY is not blocked", () => {
    const body = { tagName: "BODY", isContentEditable: false } as HTMLElement;
    assert.equal(isEditableTarget(body), false, "shortcut should fire when focus is on BODY");
  });
});

// ---------------------------------------------------------------------------
// computeRovingIndex — pure logic
// ---------------------------------------------------------------------------

describe("computeRovingIndex", () => {
  const total = 4;

  // ---- ArrowRight / ArrowLeft (always active) ----------------------------

  test("ArrowRight advances to next item", () => {
    assert.equal(computeRovingIndex("ArrowRight", 0, total), 1);
    assert.equal(computeRovingIndex("ArrowRight", 2, total), 3);
  });

  test("ArrowRight wraps around at the last item", () => {
    assert.equal(computeRovingIndex("ArrowRight", 3, total), 0);
  });

  test("ArrowLeft goes to previous item", () => {
    assert.equal(computeRovingIndex("ArrowLeft", 2, total), 1);
    assert.equal(computeRovingIndex("ArrowLeft", 3, total), 2);
  });

  test("ArrowLeft wraps to last item from first", () => {
    assert.equal(computeRovingIndex("ArrowLeft", 0, total), 3);
  });

  // ---- Vertical arrows (only when vertical:true) -------------------------

  test("ArrowDown advances when vertical=true (reader tools tab bar)", () => {
    assert.equal(computeRovingIndex("ArrowDown", 1, total, { vertical: true }), 2);
  });

  test("ArrowDown returns null when vertical=false (default)", () => {
    assert.equal(computeRovingIndex("ArrowDown", 1, total), null);
  });

  test("ArrowUp goes back when vertical=true", () => {
    assert.equal(computeRovingIndex("ArrowUp", 2, total, { vertical: true }), 1);
  });

  test("ArrowUp wraps when vertical=true", () => {
    assert.equal(computeRovingIndex("ArrowUp", 0, total, { vertical: true }), 3);
  });

  // ---- Home / End (only when homeEnd:true) --------------------------------

  test("Home jumps to first item when homeEnd=true", () => {
    assert.equal(computeRovingIndex("Home", 3, total, { homeEnd: true }), 0);
  });

  test("End jumps to last item when homeEnd=true", () => {
    assert.equal(computeRovingIndex("End", 0, total, { homeEnd: true }), 3);
  });

  test("Home returns null when homeEnd=false (default)", () => {
    assert.equal(computeRovingIndex("Home", 3, total), null);
  });

  test("End returns null when homeEnd=false (default)", () => {
    assert.equal(computeRovingIndex("End", 0, total), null);
  });

  // ---- Non-navigation keys ------------------------------------------------

  test("returns null for unrelated keys (Escape, Enter, Tab)", () => {
    assert.equal(computeRovingIndex("Escape", 0, total), null);
    assert.equal(computeRovingIndex("Enter", 0, total), null);
    assert.equal(computeRovingIndex("Tab", 0, total), null);
  });

  // ---- Flashcard grading context: 4 items, ArrowRight/Left work ----------

  test("flashcard grade keys (1-4) are NOT navigation keys", () => {
    assert.equal(computeRovingIndex("1", 0, 4), null);
    assert.equal(computeRovingIndex("4", 3, 4), null);
  });

  // ---- Nested overlay Escape — NOT a roving key --------------------------

  test("Escape is NOT a roving navigation key (returns null)", () => {
    assert.equal(computeRovingIndex("Escape", 2, 6), null,
      "Escape should not move focus; it's handled separately as onEscape callback");
  });

  // ---- Edge case: total = 0 -----------------------------------------------

  test("returns null when total is 0", () => {
    assert.equal(computeRovingIndex("ArrowRight", 0, 0), null);
  });
});

// ---------------------------------------------------------------------------
// SHORTCUT_GROUPS registry metadata invariants
// ---------------------------------------------------------------------------

describe("SHORTCUT_GROUPS registry metadata", () => {
  test("all groups have a non-empty label", () => {
    for (const group of SHORTCUT_GROUPS) {
      assert.ok(group.label.trim().length > 0, `Group label should not be empty`);
    }
  });

  test("all shortcuts have non-empty keys and description", () => {
    for (const group of SHORTCUT_GROUPS) {
      for (const shortcut of group.shortcuts) {
        assert.ok(shortcut.keys.length > 0, `Shortcut in "${group.label}" must have at least one key`);
        assert.ok(shortcut.description.trim().length > 0, `Shortcut keys=${shortcut.keys.join("+")} must have a description`);
      }
    }
  });

  test("non-reference-only shortcuts have a runtimeOwner", () => {
    for (const group of SHORTCUT_GROUPS) {
      for (const shortcut of group.shortcuts) {
        if (shortcut.scope === "reference-only" || shortcut.scope === undefined) continue;
        assert.ok(
          shortcut.runtimeOwner && shortcut.runtimeOwner.trim().length > 0,
          `Shortcut "${shortcut.description}" (scope: ${shortcut.scope}) must have a runtimeOwner`,
        );
      }
    }
  });

  test("global shortcuts suppressed in inputs have disabledInInput=true (command palette open, shortcuts modal)", () => {
    const globalSuppressed = SHORTCUT_GROUPS
      .flatMap((g) => g.shortcuts)
      .filter((s) => s.scope === "global" && s.disabledInInput === true);
    const descriptions = globalSuppressed.map((s) => s.description);
    assert.ok(
      descriptions.some((d) => d.includes("command palette") && d.includes("not in a field")),
      "Expected '/' shortcut (suppressed in inputs) to be listed",
    );
    assert.ok(
      descriptions.some((d) => d.toLowerCase().includes("keyboard shortcuts")),
      "Expected '?' shortcut (suppressed in inputs) to be listed",
    );
  });

  test("⌘K shortcut is in Navigation and owned by CommandPaletteProvider", () => {
    const nav = SHORTCUT_GROUPS.find((g) => g.label === "Navigation");
    assert.ok(nav, "Navigation group must exist");
    const cmdK = nav!.shortcuts.find((s) => s.keys.includes("⌘K"));
    assert.ok(cmdK, "⌘K shortcut must be listed");
    assert.equal(cmdK!.runtimeOwner, "CommandPaletteProvider");
    assert.equal(cmdK!.scope, "global");
  });

  test("flashcard shortcuts are all scoped to 'flashcard' and owned by FlashcardReview", () => {
    const flashcard = SHORTCUT_GROUPS.find((g) => g.label === "Flashcard study");
    assert.ok(flashcard, "Flashcard study group must exist");
    for (const shortcut of flashcard!.shortcuts) {
      assert.equal(shortcut.scope, "flashcard",
        `"${shortcut.description}" must have scope=flashcard`);
      assert.equal(shortcut.runtimeOwner, "FlashcardReview",
        `"${shortcut.description}" must be owned by FlashcardReview`);
    }
  });

  test("reader tool tab arrow shortcut is scoped to 'reader' and owned by ReaderTools", () => {
    const reader = SHORTCUT_GROUPS.find((g) => g.label === "Reader");
    assert.ok(reader, "Reader group must exist");
    const arrows = reader!.shortcuts.find((s) => s.keys.includes("←") && s.keys.includes("→"));
    assert.ok(arrows, "Arrow shortcut must be listed in Reader group");
    assert.equal(arrows!.scope, "reader");
    assert.equal(arrows!.runtimeOwner, "ReaderTools");
  });

  test("shortcut modal entries correspond to runtime behavior or are explicitly reference-only", () => {
    const allShortcuts = SHORTCUT_GROUPS.flatMap((g) => g.shortcuts);
    for (const shortcut of allShortcuts) {
      const hasScope = shortcut.scope !== undefined;
      assert.ok(
        hasScope,
        `Shortcut "${shortcut.description}" must have a scope to avoid display/runtime drift`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Export shape checks (function identity without calling hooks)
// ---------------------------------------------------------------------------

describe("focus-trap module exports", () => {
  test("getTabbable is exported as a function", () => {
    assert.equal(typeof getTabbable, "function");
  });

  test("useFocusTrap is exported as a function", () => {
    assert.equal(typeof useFocusTrap, "function");
  });
});

describe("use-keyboard-shortcut module exports", () => {
  test("useKeyboardShortcut is exported as a function", () => {
    assert.equal(typeof useKeyboardShortcut, "function");
  });

  test("isEditableTarget is exported as a function", () => {
    assert.equal(typeof isEditableTarget, "function");
  });
});

describe("use-roving-tabindex module exports", () => {
  test("useRovingTabindex is exported as a function", () => {
    assert.equal(typeof useRovingTabindex, "function");
  });

  test("computeRovingIndex is exported as a function", () => {
    assert.equal(typeof computeRovingIndex, "function");
  });
});

