import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { SHORTCUT_GROUPS } from "@/lib/keyboard-shortcuts";

const allShortcuts = SHORTCUT_GROUPS.flatMap((group) => group.shortcuts);

function findGroup(label: string) {
  const group = SHORTCUT_GROUPS.find((item) => item.label === label);
  assert.ok(group, `${label} group must exist`);
  return group;
}

describe("SHORTCUT_GROUPS registry metadata", () => {
  test("all groups have a non-empty label", () => {
    for (const group of SHORTCUT_GROUPS) {
      assert.ok(group.label.trim().length > 0, "Group label should not be empty");
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

  test("global shortcuts suppressed in inputs include command palette and shortcuts modal entries", () => {
    const globalSuppressed = allShortcuts.filter(
      (shortcut) => shortcut.scope === "global" && shortcut.disabledInInput === true,
    );
    const descriptions = globalSuppressed.map((shortcut) => shortcut.description);

    assert.ok(
      descriptions.some((description) => description.includes("command palette") && description.includes("not in a field")),
      "Expected '/' shortcut (suppressed in inputs) to be listed",
    );
    assert.ok(
      descriptions.some((description) => description.toLowerCase().includes("keyboard shortcuts")),
      "Expected '?' shortcut (suppressed in inputs) to be listed",
    );
  });

  test("⌘K shortcut is in Navigation and owned by CommandPaletteProvider", () => {
    const nav = findGroup("Navigation");
    const cmdK = nav.shortcuts.find((shortcut) => shortcut.keys.includes("⌘K"));
    assert.ok(cmdK, "⌘K shortcut must be listed");
    assert.equal(cmdK.runtimeOwner, "CommandPaletteProvider");
    assert.equal(cmdK.scope, "global");
  });

  test("flashcard shortcuts are scoped to flashcard and owned by FlashcardReview", () => {
    const flashcard = findGroup("Flashcard study");
    for (const shortcut of flashcard.shortcuts) {
      assert.equal(shortcut.scope, "flashcard", `"${shortcut.description}" must have scope=flashcard`);
      assert.equal(shortcut.runtimeOwner, "FlashcardReview", `"${shortcut.description}" must be owned by FlashcardReview`);
    }
  });

  test("reader tool tab arrow shortcut is scoped to reader and owned by ReaderTools", () => {
    const reader = findGroup("Reader");
    const arrows = reader.shortcuts.find((shortcut) => shortcut.keys.includes("←") && shortcut.keys.includes("→"));
    assert.ok(arrows, "Arrow shortcut must be listed in Reader group");
    assert.equal(arrows.scope, "reader");
    assert.equal(arrows.runtimeOwner, "ReaderTools");
  });

  test("shortcut modal entries correspond to runtime behavior or are explicitly reference-only", () => {
    for (const shortcut of allShortcuts) {
      assert.ok(
        shortcut.scope !== undefined,
        `Shortcut "${shortcut.description}" must have a scope to avoid display/runtime drift`,
      );
    }
  });
});
