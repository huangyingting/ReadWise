import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { beginRender, runCleanups } from "./support/react-hook-harness";

function makeEl(opts: {
  tabIndex?: number;
  hidden?: boolean;
  rendered?: boolean;
} = {}): HTMLElement {
  const { tabIndex = 0, hidden = false, rendered = true } = opts;
  return {
    tabIndex,
    closest: (selector: string) =>
      selector === "[hidden]" && hidden ? {} : null,
    getClientRects: () => (rendered ? [{}] : []),
  } as unknown as HTMLElement;
}

function makeContainer(elements: HTMLElement[]): HTMLElement {
  return {
    querySelectorAll: () => elements,
  } as unknown as HTMLElement;
}

describe("getTabbable", () => {
  test("returns [] for null root or an empty root", async () => {
    const { getTabbable } = await import("@/lib/focus-trap");

    assert.deepEqual(getTabbable(null), []);
    assert.deepEqual(getTabbable(makeContainer([])), []);
  });

  test("includes visible elements with tabIndex >= 0 and preserves DOM order", async () => {
    const { getTabbable } = await import("@/lib/focus-trap");
    const first = makeEl({ tabIndex: 0 });
    const second = makeEl({ tabIndex: 3 });
    const third = makeEl();

    assert.deepEqual(getTabbable(makeContainer([first, second, third])), [first, second, third]);
  });

  test("excludes inactive, hidden, and unrendered elements", async () => {
    const { getTabbable } = await import("@/lib/focus-trap");
    const visible = makeEl({ tabIndex: 0 });
    const rovingInactive = makeEl({ tabIndex: -1 });
    const hiddenEl = makeEl({ hidden: true });
    const notRendered = makeEl({ rendered: false });

    assert.deepEqual(
      getTabbable(makeContainer([visible, rovingInactive, hiddenEl, notRendered])),
      [visible],
    );
  });
});

describe("focus trap hook behavior", () => {
  function installFocusDocument() {
    let listener: ((event: KeyboardEvent) => void) | null = null;
    const removed: boolean[] = [];
    const documentStub = {
      activeElement: null as HTMLElement | null,
      addEventListener(
        type: string,
        callback: (event: KeyboardEvent) => void,
        capture?: boolean,
      ) {
        assert.equal(type, "keydown");
        listener = callback;
        this.capture = Boolean(capture);
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
      capture: false,
    };
    Object.assign(globalThis, { document: documentStub });

    function makeFocusable(name: string, options: { rendered?: boolean; tabIndex?: number } = {}) {
      const el = {
        tabIndex: options.tabIndex ?? 0,
        closest: () => null,
        getClientRects: () => (options.rendered === false ? [] : [{}]),
        focus: () => {
          documentStub.activeElement = el as unknown as HTMLElement;
          focusOrder.push(name);
        },
      };
      return el as unknown as HTMLElement;
    }

    const focusOrder: string[] = [];
    return {
      documentStub,
      focusOrder,
      makeFocusable,
      removed,
      fire(event: Partial<KeyboardEvent>) {
        let prevented = false;
        let stopped = false;
        listener?.({
          key: "",
          preventDefault: () => {
            prevented = true;
          },
          stopImmediatePropagation: () => {
            stopped = true;
          },
          ...event,
        } as KeyboardEvent);
        return { prevented, stopped };
      },
    };
  }

  test("does nothing when inactive", async () => {
    const { useFocusTrap } = await import("@/lib/focus-trap");
    const focus = installFocusDocument();

    beginRender();
    useFocusTrap({ current: focus.makeFocusable("container") }, false, () => {
      assert.fail("inactive trap should not handle Escape");
    });

    assert.equal(focus.fire({ key: "Escape" }).prevented, false);
  });

  test("focuses the initial element, handles Escape, and restores opener focus", async () => {
    const { useFocusTrap } = await import("@/lib/focus-trap");
    const focus = installFocusDocument();
    const opener = focus.makeFocusable("opener");
    const close = focus.makeFocusable("close");
    const first = focus.makeFocusable("first");
    const container = {
      querySelectorAll: () => [first],
      focus: () => focus.focusOrder.push("container"),
    } as unknown as HTMLElement;
    focus.documentStub.activeElement = opener;
    let escapes = 0;

    beginRender();
    useFocusTrap({ current: container }, true, () => escapes++, {
      capture: true,
      initialFocusRef: { current: close },
      restoreFocus: true,
      stopEscapePropagation: true,
    });

    assert.equal(focus.focusOrder.at(-1), "close");
    const escapeResult = focus.fire({ key: "Escape" });
    runCleanups();

    assert.equal(escapes, 1);
    assert.deepEqual(escapeResult, { prevented: true, stopped: true });
    assert.equal(focus.documentStub.activeElement, opener);
    assert.deepEqual(focus.removed, [true]);
  });

  test("cycles Tab within tabbables and lets non-boundary Tab movement continue", async () => {
    const { useFocusTrap } = await import("@/lib/focus-trap");
    const focus = installFocusDocument();
    const first = focus.makeFocusable("first");
    const middle = focus.makeFocusable("middle");
    const last = focus.makeFocusable("last");
    const container = {
      querySelectorAll: () => [first, middle, last],
      focus: () => focus.focusOrder.push("container"),
    } as unknown as HTMLElement;

    beginRender();
    useFocusTrap({ current: container }, true, () => {});

    focus.documentStub.activeElement = last;
    assert.equal(focus.fire({ key: "Tab", shiftKey: false }).prevented, true);
    assert.equal(focus.focusOrder.at(-1), "first");

    focus.documentStub.activeElement = first;
    assert.equal(focus.fire({ key: "Tab", shiftKey: true }).prevented, true);
    assert.equal(focus.focusOrder.at(-1), "last");

    focus.documentStub.activeElement = middle;
    assert.equal(focus.fire({ key: "Tab", shiftKey: false }).prevented, false);
    focus.documentStub.activeElement = middle;
    assert.equal(focus.fire({ key: "Tab", shiftKey: true }).prevented, false);
    focus.documentStub.activeElement = first;
    assert.equal(focus.fire({ key: "Tab", shiftKey: false }).prevented, false);
    focus.documentStub.activeElement = last;
    assert.equal(focus.fire({ key: "Tab", shiftKey: true }).prevented, false);
    assert.equal(focus.fire({ key: "ArrowRight" }).prevented, false);
  });

  test("focuses the container when the trap has no tabbable descendants", async () => {
    const { useFocusTrap } = await import("@/lib/focus-trap");
    const focus = installFocusDocument();
    const container = {
      querySelectorAll: () => [],
      focus: () => focus.focusOrder.push("container"),
    } as unknown as HTMLElement;

    beginRender();
    useFocusTrap({ current: container }, true, () => {});

    assert.equal(focus.fire({ key: "Tab" }).prevented, true);
    assert.equal(focus.focusOrder.at(-1), "container");
  });
});
