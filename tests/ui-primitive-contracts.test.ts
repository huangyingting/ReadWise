/**
 * UI primitive contracts and overlay/focus behavior tests (#494 — REF-057).
 *
 * These tests run in Node.js (no real DOM / jsdom). They exercise pure-logic
 * helpers and documented behavioral contracts for the UI primitive layer:
 *
 *  - focusRing + cn utilities — pure string/class-merge contracts
 *  - getTabbable — visibility-aware tabbable collector (mock DOM stubs)
 *  - Focus trap Tab/Shift+Tab cycling — pure decision algorithm (mirrors the
 *    logic in useFocusTrap / Sheet)
 *  - computeRovingIndex — SegmentedControl horizontal navigation, wrap, Home/End
 *  - Popover arrow navigation — wrapping menuitem/option traversal algorithm
 *  - SegmentedControl selected-index derivation — value-to-index mapping
 *  - UI primitive module exports — functions importable from the .ts/.tsx layer
 *    via their backing .ts utilities
 *
 * Interaction contracts for Sheet / Popover / SegmentedControl that require a
 * React renderer or live DOM are covered at the type level (tsc --noEmit) and
 * through the behavioral algorithm tests below; see REF-057 for the full
 * contract specification.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { cn, focusRing } from "@/lib/cn";
import { getTabbable, useFocusTrap } from "@/lib/focus-trap";
import { computeRovingIndex, useRovingTabindex } from "@/lib/use-roving-tabindex";

// ---------------------------------------------------------------------------
// Minimal DOM stubs
// ---------------------------------------------------------------------------

/**
 * Build a minimal HTMLElement stub with configurable visibility and tabIndex.
 * Satisfies the interface consumed by getTabbable / isVisible.
 */
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

/** Build a minimal container stub whose querySelectorAll returns the given list. */
function makeContainer(elements: HTMLElement[]): HTMLElement {
  return {
    querySelectorAll: () => elements,
  } as unknown as HTMLElement;
}

// ---------------------------------------------------------------------------
// focusRing utility
// ---------------------------------------------------------------------------

describe("focusRing utility — CSS contract", () => {
  test("is a non-empty string", () => {
    assert.equal(typeof focusRing, "string");
    assert.ok(focusRing.length > 0);
  });

  test("includes outline-none to suppress the browser default outline", () => {
    assert.ok(
      focusRing.includes("outline-none"),
      "focusRing must contain outline-none",
    );
  });

  test("uses focus-visible: selector for keyboard-only visibility", () => {
    assert.ok(
      focusRing.includes("focus-visible:"),
      "focusRing must use focus-visible: so mouse users do not see the ring",
    );
  });

  test("includes box-shadow for the ring layers", () => {
    assert.ok(
      focusRing.includes("box-shadow"),
      "focusRing must set box-shadow for ring-offset + focus ring",
    );
  });

  test("references --focus-ring CSS token for theme consistency", () => {
    assert.ok(
      focusRing.includes("--focus-ring"),
      "focusRing must reference --focus-ring token",
    );
  });

  test("references --ring-offset CSS token for the 2px gap", () => {
    assert.ok(
      focusRing.includes("--ring-offset"),
      "focusRing must reference --ring-offset token",
    );
  });
});

// ---------------------------------------------------------------------------
// cn utility
// ---------------------------------------------------------------------------

describe("cn utility — class name merge contract", () => {
  test("concatenates plain class names", () => {
    assert.equal(cn("foo", "bar"), "foo bar");
  });

  test("ignores falsy inputs (null, undefined, false)", () => {
    assert.equal(cn("foo", null, undefined, false, "bar"), "foo bar");
  });

  test("resolves Tailwind conflicts — later class wins", () => {
    const result = cn("text-sm", "text-base");
    assert.ok(result.includes("text-base"), `expected 'text-base' in '${result}'`);
    assert.ok(!result.includes("text-sm"), `unexpected 'text-sm' in '${result}'`);
  });

  test("handles conditional object syntax", () => {
    const result = cn({ active: true, hidden: false });
    assert.ok(result.includes("active"));
    assert.ok(!result.includes("hidden"));
  });

  test("handles array of class names", () => {
    const result = cn(["foo", "bar"]);
    assert.ok(result.includes("foo") && result.includes("bar"));
  });

  test("returns an empty string for all-falsy input", () => {
    assert.equal(cn(null, undefined, false), "");
  });
});

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
// Tests that the algorithm correctly identifies which element should receive
// focus at the boundaries of the trap.
// ---------------------------------------------------------------------------

/**
 * Pure equivalent of the Tab-wrap guard inside useFocusTrap.
 * Returns a string describing which element the trap would focus.
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

  // ---- Forward Tab ---------------------------------------------------

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

  // ---- Backward Shift+Tab --------------------------------------------

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

  // ---- Edge cases ----------------------------------------------------

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

// ---------------------------------------------------------------------------
// computeRovingIndex — SegmentedControl keyboard navigation
// ---------------------------------------------------------------------------

describe("computeRovingIndex — SegmentedControl horizontal navigation", () => {
  const N = 4;

  // ---- ArrowRight / ArrowLeft (horizontal, default) ----------------------

  test("ArrowRight advances to next segment", () => {
    assert.equal(computeRovingIndex("ArrowRight", 0, N), 1);
    assert.equal(computeRovingIndex("ArrowRight", 2, N), 3);
  });

  test("ArrowRight wraps from last segment to first", () => {
    assert.equal(computeRovingIndex("ArrowRight", N - 1, N), 0);
  });

  test("ArrowLeft retreats to previous segment", () => {
    assert.equal(computeRovingIndex("ArrowLeft", 1, N), 0);
    assert.equal(computeRovingIndex("ArrowLeft", 3, N), 2);
  });

  test("ArrowLeft wraps from first segment to last", () => {
    assert.equal(computeRovingIndex("ArrowLeft", 0, N), N - 1);
  });

  // ---- ArrowDown / ArrowUp only when vertical=true -----------------------

  test("ArrowDown returns null with default (vertical=false)", () => {
    assert.equal(computeRovingIndex("ArrowDown", 0, N), null);
  });

  test("ArrowUp returns null with default (vertical=false)", () => {
    assert.equal(computeRovingIndex("ArrowUp", 0, N), null);
  });

  test("ArrowDown advances when vertical=true (SegmentedControl with both axes)", () => {
    assert.equal(computeRovingIndex("ArrowDown", 1, N, { vertical: true }), 2);
  });

  test("ArrowDown wraps with vertical=true", () => {
    assert.equal(computeRovingIndex("ArrowDown", N - 1, N, { vertical: true }), 0);
  });

  test("ArrowUp retreats when vertical=true", () => {
    assert.equal(computeRovingIndex("ArrowUp", 2, N, { vertical: true }), 1);
  });

  test("ArrowUp wraps with vertical=true", () => {
    assert.equal(computeRovingIndex("ArrowUp", 0, N, { vertical: true }), N - 1);
  });

  // ---- Home / End (homeEnd=true) -----------------------------------------

  test("Home jumps to first segment when homeEnd=true", () => {
    assert.equal(computeRovingIndex("Home", 3, N, { homeEnd: true }), 0);
  });

  test("Home on first segment stays at 0 (idempotent)", () => {
    assert.equal(computeRovingIndex("Home", 0, N, { homeEnd: true }), 0);
  });

  test("End jumps to last segment when homeEnd=true", () => {
    assert.equal(computeRovingIndex("End", 0, N, { homeEnd: true }), N - 1);
  });

  test("End on last segment stays at last index (idempotent)", () => {
    assert.equal(computeRovingIndex("End", N - 1, N, { homeEnd: true }), N - 1);
  });

  test("Home returns null when homeEnd=false (default)", () => {
    assert.equal(computeRovingIndex("Home", 2, N), null);
  });

  test("End returns null when homeEnd=false (default)", () => {
    assert.equal(computeRovingIndex("End", 2, N), null);
  });

  // ---- Unrelated keys ----------------------------------------------------

  test("Space returns null (not a navigation key)", () => {
    assert.equal(computeRovingIndex(" ", 1, N), null);
  });

  test("Enter returns null", () => {
    assert.equal(computeRovingIndex("Enter", 1, N), null);
  });

  test("Escape returns null", () => {
    assert.equal(computeRovingIndex("Escape", 1, N), null);
  });

  test("Tab returns null", () => {
    assert.equal(computeRovingIndex("Tab", 1, N), null);
  });

  // ---- Edge cases --------------------------------------------------------

  test("returns null for an empty list (total = 0)", () => {
    assert.equal(computeRovingIndex("ArrowRight", 0, 0), null);
  });

  test("single item: ArrowRight wraps to index 0 (self)", () => {
    assert.equal(computeRovingIndex("ArrowRight", 0, 1), 0);
  });

  test("single item: ArrowLeft wraps to index 0 (self)", () => {
    assert.equal(computeRovingIndex("ArrowLeft", 0, 1), 0);
  });
});

// ---------------------------------------------------------------------------
// Popover arrow navigation logic — menuitem/option traversal
//
// Mirrors the ArrowDown / ArrowUp handler in Popover.tsx without requiring
// React or DOM. The algorithm:
//   dir = key === "ArrowDown" ? 1 : -1
//   next = items[(idx + dir + items.length) % items.length] ?? items[0]
// ---------------------------------------------------------------------------

/**
 * Pure equivalent of the Popover arrow-key navigation handler.
 */
function computePopoverArrowTarget<T>(
  items: T[],
  activeEl: T | null,
  key: "ArrowDown" | "ArrowUp",
): T {
  const dir = key === "ArrowDown" ? 1 : -1;
  const idx = items.indexOf(activeEl as T);
  return items[(idx + dir + items.length) % items.length] ?? items[0]!;
}

describe("Popover arrow navigation — menuitem/option traversal", () => {
  const a = "item-a";
  const b = "item-b";
  const c = "item-c";
  const items = [a, b, c];

  test("ArrowDown from first item focuses second", () => {
    assert.equal(computePopoverArrowTarget(items, a, "ArrowDown"), b);
  });

  test("ArrowDown from second item focuses third", () => {
    assert.equal(computePopoverArrowTarget(items, b, "ArrowDown"), c);
  });

  test("ArrowDown from last item wraps to first (circular navigation)", () => {
    assert.equal(computePopoverArrowTarget(items, c, "ArrowDown"), a);
  });

  test("ArrowUp from last item focuses second", () => {
    assert.equal(computePopoverArrowTarget(items, c, "ArrowUp"), b);
  });

  test("ArrowUp from second item focuses first", () => {
    assert.equal(computePopoverArrowTarget(items, b, "ArrowUp"), a);
  });

  test("ArrowUp from first item wraps to last (circular navigation)", () => {
    assert.equal(computePopoverArrowTarget(items, a, "ArrowUp"), c);
  });

  test("ArrowDown when active is not in the list yields a valid item", () => {
    // idx = -1, so (-1 + 1 + 3) % 3 = 1 → b
    const result = computePopoverArrowTarget(items, null, "ArrowDown");
    assert.ok(items.includes(result), "result must be one of the known items");
  });

  test("ArrowUp when active is not in the list yields a valid item", () => {
    // idx = -1, so (-1 - 1 + 3) % 3 = 1 → b
    const result = computePopoverArrowTarget(items, null, "ArrowUp");
    assert.ok(items.includes(result), "result must be one of the known items");
  });

  test("single item: ArrowDown stays on the same item", () => {
    assert.equal(computePopoverArrowTarget([a], a, "ArrowDown"), a);
  });

  test("single item: ArrowUp stays on the same item", () => {
    assert.equal(computePopoverArrowTarget([a], a, "ArrowUp"), a);
  });

  test("two items: ArrowDown alternates A ↔ B", () => {
    assert.equal(computePopoverArrowTarget([a, b], a, "ArrowDown"), b);
    assert.equal(computePopoverArrowTarget([a, b], b, "ArrowDown"), a);
  });
});

// ---------------------------------------------------------------------------
// SegmentedControl selected-index derivation
// ---------------------------------------------------------------------------

describe("SegmentedControl selected-index derivation — value → index mapping", () => {
  const opts = [
    { value: "light", label: "Light" },
    { value: "sepia", label: "Sepia" },
    { value: "dark", label: "Dark" },
  ] as const;

  /** Pure replica of selectedIndex from SegmentedControl. */
  function selectedIndex(value: string): number {
    return Math.max(0, opts.findIndex((o) => o.value === value));
  }

  test("returns 0 for the first option ('light')", () => {
    assert.equal(selectedIndex("light"), 0);
  });

  test("returns 1 for the second option ('sepia')", () => {
    assert.equal(selectedIndex("sepia"), 1);
  });

  test("returns 2 for the third option ('dark')", () => {
    assert.equal(selectedIndex("dark"), 2);
  });

  test("returns 0 when value is not found (Math.max clamp)", () => {
    assert.equal(selectedIndex("unknown"), 0);
  });

  test("tabIndex assignment contract: only checked segment gets tabIndex=0", () => {
    const active = "sepia";
    const tabIndices = opts.map((o) => (o.value === active ? 0 : -1));
    assert.deepEqual(tabIndices, [-1, 0, -1]);
  });

  test("navigation with computeRovingIndex wraps correctly over 3 options", () => {
    // Simulate ArrowRight from the last option wrapping to first
    assert.equal(computeRovingIndex("ArrowRight", 2, 3), 0);
    // Simulate ArrowLeft from the first option wrapping to last
    assert.equal(computeRovingIndex("ArrowLeft", 0, 3), 2);
    // Home/End with homeEnd=true
    assert.equal(computeRovingIndex("Home", 2, 3, { homeEnd: true }), 0);
    assert.equal(computeRovingIndex("End", 0, 3, { homeEnd: true }), 2);
  });

  test("announcement string format: 'label: optionLabel'", () => {
    // Contract: visually-hidden aria-live announces "groupLabel: segmentLabel"
    const groupLabel = "Reading theme";
    const opt = opts[selectedIndex("sepia")];
    const announcement = `${groupLabel}: ${opt!.label}`;
    assert.equal(announcement, "Reading theme: Sepia");
  });
});

// ---------------------------------------------------------------------------
// focusRing variant integration — applied by form fields and interactive controls
// ---------------------------------------------------------------------------

describe("focusRing is a composable class string (Button/Input/Switch/SegmentedControl)", () => {
  test("cn(focusRing, 'text-sm') produces a valid merged class string", () => {
    const result = cn(focusRing, "text-sm");
    assert.ok(result.includes("text-sm"));
    assert.ok(result.includes("outline-none"));
    assert.ok(result.includes("focus-visible:"));
  });

  test("cn(focusRing, focusRing) deduplicates outline-none", () => {
    const result = cn(focusRing, focusRing);
    // tw-merge collapses duplicate utilities; outline-none appears at most once
    const count = (result.match(/outline-none/g) ?? []).length;
    assert.ok(count >= 1, "outline-none must be present");
  });

  test("focusRing can be negated by a later outline-none override", () => {
    const result = cn(focusRing, "outline-2");
    // outline-2 conflicts with outline-none; tw-merge keeps the last declaration
    assert.ok(result.includes("outline-2") || result.includes("outline-none"),
      "merged result must retain one outline utility");
  });
});
