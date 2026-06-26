/**
 * Tests for the Popover arrow-key navigation algorithm (REF-057).
 *
 * Pure menuitem/option traversal logic — no mocks, no DOM, no React.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Popover arrow navigation logic — menuitem/option traversal
//
// Mirrors the ArrowDown / ArrowUp handler in Popover.tsx without requiring
// React or DOM. The algorithm:
//   dir = key === "ArrowDown" ? 1 : -1
//   next = items[(idx + dir + items.length) % items.length] ?? items[0]
// ---------------------------------------------------------------------------

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
