/**
 * Tests for the getTabbable / useFocusTrap utilities (REF-057).
 *
 * Pure-logic focus-trap tests — minimal DOM stubs, no jsdom.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { getTabbable, useFocusTrap } from "@/lib/focus-trap";

// ---------------------------------------------------------------------------
// Minimal DOM stubs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// getTabbable — visibility-aware tabbable collector (Sheet / useFocusTrap)
// ---------------------------------------------------------------------------

describe("getTabbable — Sheet/overlay focus trap collector", () => {
  test("returns [] for null root", () => {
    assert.deepEqual(getTabbable(null), []);
  });

  test("includes visible elements with tabIndex === 0", () => {
    const btn = makeEl({ tabIndex: 0 });
    const root = makeContainer([btn]);
    const result = getTabbable(root);
    assert.equal(result.length, 1);
    assert.equal(result[0], btn);
  });

  test("includes elements with tabIndex > 0 (explicit tab-order items)", () => {
    const high = makeEl({ tabIndex: 3 });
    const root = makeContainer([high]);
    assert.equal(getTabbable(root).length, 1);
  });

  test("excludes elements with tabIndex === -1 (roving-tabindex inactive buttons)", () => {
    const inactive = makeEl({ tabIndex: -1 });
    const root = makeContainer([inactive]);
    assert.deepEqual(getTabbable(root), []);
  });

  test("excludes elements inside a [hidden] subtree", () => {
    const hiddenEl = makeEl({ hidden: true });
    const root = makeContainer([hiddenEl]);
    assert.deepEqual(getTabbable(root), []);
  });

  test("excludes elements with no client rects (display:none / detached)", () => {
    const invisible = makeEl({ rendered: false });
    const root = makeContainer([invisible]);
    assert.deepEqual(getTabbable(root), []);
  });

  test("filters a mixed list — only visible tabIndex>=0 elements survive", () => {
    const visible = makeEl({ tabIndex: 0 });
    const rovingInactive = makeEl({ tabIndex: -1 });
    const hiddenEl = makeEl({ hidden: true });
    const notRendered = makeEl({ rendered: false });
    const root = makeContainer([visible, rovingInactive, hiddenEl, notRendered]);
    const result = getTabbable(root);
    assert.equal(result.length, 1);
    assert.equal(result[0], visible);
  });

  test("preserves DOM order (first element from querySelectorAll is index 0)", () => {
    const first = makeEl();
    const second = makeEl();
    const third = makeEl();
    const root = makeContainer([first, second, third]);
    assert.deepEqual(getTabbable(root), [first, second, third]);
  });

  test("returns [] for a root with no matching elements", () => {
    const root = makeContainer([]);
    assert.deepEqual(getTabbable(root), []);
  });
});

// ---------------------------------------------------------------------------
// Focus trap Tab cycling logic — Sheet overlay contract
//
// Pure replica of the Tab/Shift+Tab wrap decision in useFocusTrap.
// ---------------------------------------------------------------------------

/**
 * Pure equivalent of the Tab-wrap guard inside useFocusTrap.
 */
function computeTrapTabTarget(
  list: HTMLElement[],
  activeEl: HTMLElement | null,
  container: HTMLElement,
  shiftKey: boolean,
): "first" | "last" | "container" | "none" {
  if (list.length === 0) return "container";
  const first = list[0]!;
  const last = list[list.length - 1]!;
  if (shiftKey && (activeEl === first || activeEl === container)) return "last";
  if (!shiftKey && activeEl === last) return "first";
  return "none";
}

describe("focus trap Tab cycling — Sheet overlay contract", () => {
  const btn1 = makeEl();
  const btn2 = makeEl();
  const btn3 = makeEl();
  const container = makeEl({ tabIndex: -1 });

  test("Tab at last element wraps to first (forward cycle)", () => {
    assert.equal(
      computeTrapTabTarget([btn1, btn2, btn3], btn3, container, false),
      "first",
    );
  });

  test("Tab at a middle element does not wrap", () => {
    assert.equal(
      computeTrapTabTarget([btn1, btn2, btn3], btn2, container, false),
      "none",
    );
  });

  test("Tab at first element does not wrap (natural Tab order continues)", () => {
    assert.equal(
      computeTrapTabTarget([btn1, btn2, btn3], btn1, container, false),
      "none",
    );
  });

  test("Shift+Tab at first element wraps to last", () => {
    assert.equal(
      computeTrapTabTarget([btn1, btn2, btn3], btn1, container, true),
      "last",
    );
  });

  test("Shift+Tab from the container itself wraps to last", () => {
    assert.equal(
      computeTrapTabTarget([btn1, btn2, btn3], container, container, true),
      "last",
    );
  });

  test("Shift+Tab at a middle element does not wrap", () => {
    assert.equal(
      computeTrapTabTarget([btn1, btn2, btn3], btn2, container, true),
      "none",
    );
  });

  test("Shift+Tab at last element does not wrap backward", () => {
    assert.equal(
      computeTrapTabTarget([btn1, btn2, btn3], btn3, container, true),
      "none",
    );
  });

  test("empty tabbable list falls back to container focus (empty-focusable case)", () => {
    assert.equal(computeTrapTabTarget([], btn1, container, false), "container");
  });

  test("single-element list: Tab wraps to itself (first === last)", () => {
    assert.equal(computeTrapTabTarget([btn1], btn1, container, false), "first");
  });

  test("single-element list: Shift+Tab wraps to itself", () => {
    assert.equal(computeTrapTabTarget([btn1], btn1, container, true), "last");
  });

  test("element not in the list does not trigger wrap", () => {
    const outsider = makeEl();
    assert.equal(
      computeTrapTabTarget([btn1, btn2, btn3], outsider, container, false),
      "none",
    );
  });
});
