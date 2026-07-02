import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  beginRender,
  resetHookStorage,
  runCleanups,
} from "./support/react-hook-harness";

describe("isEditableTarget", () => {
  test("detects editable fields and ignores non-editable targets", async () => {
    const { isEditableTarget } = await import("@/lib/use-keyboard-shortcut");

    assert.equal(isEditableTarget(null), false);
    assert.equal(isEditableTarget({} as EventTarget), false);
    assert.equal(
      isEditableTarget({ tagName: "INPUT", isContentEditable: false } as HTMLElement),
      true,
    );
    assert.equal(
      isEditableTarget({ tagName: "TEXTAREA", isContentEditable: false } as HTMLElement),
      true,
    );
    assert.equal(
      isEditableTarget({ tagName: "DIV", isContentEditable: true } as HTMLElement),
      true,
    );
    assert.equal(
      isEditableTarget({ tagName: "BUTTON", isContentEditable: false } as HTMLElement),
      false,
    );
    assert.equal(
      isEditableTarget({ tagName: "BODY", isContentEditable: false } as HTMLElement),
      false,
    );
  });
});

describe("keyboard shortcut hook behavior", () => {
  function installKeyWindow() {
    let listener: ((event: KeyboardEvent) => void) | null = null;
    const added: boolean[] = [];
    const removed: boolean[] = [];
    Object.assign(globalThis, {
      window: {
        addEventListener(
          type: string,
          callback: (event: KeyboardEvent) => void,
          capture?: boolean,
        ) {
          assert.equal(type, "keydown");
          listener = callback;
          added.push(Boolean(capture));
        },
        removeEventListener(
          type: string,
          callback: (event: KeyboardEvent) => void,
          capture?: boolean,
        ) {
          assert.equal(type, "keydown");
          assert.equal(callback, listener);
          removed.push(Boolean(capture));
        },
      },
    });
    return {
      added,
      removed,
      fire(event: Partial<KeyboardEvent>) {
        listener?.({
          altKey: false,
          ctrlKey: false,
          key: "",
          metaKey: false,
          target: { tagName: "BODY" },
          ...event,
        } as KeyboardEvent);
      },
    };
  }

  test("registers a shortcut with capture and cleans it up", async () => {
    const { useKeyboardShortcut } = await import("@/lib/use-keyboard-shortcut");
    const keyboard = installKeyWindow();
    let calls = 0;

    beginRender();
    useKeyboardShortcut("k", () => calls++, {
      capture: true,
      requireMeta: true,
      suppressInInput: true,
    });

    keyboard.fire({ key: "k" });
    keyboard.fire({ key: "K", ctrlKey: true });
    keyboard.fire({
      key: "k",
      ctrlKey: true,
      target: { tagName: "INPUT", isContentEditable: false } as never,
    });
    runCleanups();

    assert.equal(calls, 1);
    assert.deepEqual(keyboard.added, [true]);
    assert.deepEqual(keyboard.removed, [true]);
  });

  test("suppresses modifier collisions and skips disabled bindings", async () => {
    const { useKeyboardShortcut } = await import("@/lib/use-keyboard-shortcut");
    const keyboard = installKeyWindow();
    let calls = 0;

    beginRender();
    useKeyboardShortcut("?", () => calls++, {
      suppressOnModifiers: true,
    });
    keyboard.fire({ key: "?", altKey: true });
    keyboard.fire({ key: "/" });
    keyboard.fire({ key: "?" });

    assert.equal(calls, 1);

    resetHookStorage();
    installKeyWindow();
    beginRender();
    useKeyboardShortcut("x", () => calls++, { disabled: true });
    assert.equal(calls, 1);
  });
});
