import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { beginRender } from "./support/react-hook-harness";

describe("computeRovingIndex", () => {
  test("handles horizontal arrow navigation and wrapping", async () => {
    const { computeRovingIndex } = await import("@/lib/use-roving-tabindex");
    const total = 4;

    assert.equal(computeRovingIndex("ArrowRight", 0, total), 1);
    assert.equal(computeRovingIndex("ArrowRight", 2, total), 3);
    assert.equal(computeRovingIndex("ArrowRight", 3, total), 0);
    assert.equal(computeRovingIndex("ArrowLeft", 2, total), 1);
    assert.equal(computeRovingIndex("ArrowLeft", 3, total), 2);
    assert.equal(computeRovingIndex("ArrowLeft", 0, total), 3);
  });

  test("gates vertical and Home/End navigation behind options", async () => {
    const { computeRovingIndex } = await import("@/lib/use-roving-tabindex");
    const total = 4;

    assert.equal(computeRovingIndex("ArrowDown", 1, total), null);
    assert.equal(computeRovingIndex("ArrowUp", 1, total), null);
    assert.equal(computeRovingIndex("ArrowDown", 1, total, { vertical: true }), 2);
    assert.equal(computeRovingIndex("ArrowDown", 3, total, { vertical: true }), 0);
    assert.equal(computeRovingIndex("ArrowUp", 2, total, { vertical: true }), 1);
    assert.equal(computeRovingIndex("ArrowUp", 0, total, { vertical: true }), 3);
    assert.equal(computeRovingIndex("Home", 3, total), null);
    assert.equal(computeRovingIndex("End", 0, total), null);
    assert.equal(computeRovingIndex("Home", 3, total, { homeEnd: true }), 0);
    assert.equal(computeRovingIndex("Home", 0, total, { homeEnd: true }), 0);
    assert.equal(computeRovingIndex("End", 0, total, { homeEnd: true }), 3);
    assert.equal(computeRovingIndex("End", 3, total, { homeEnd: true }), 3);
  });

  test("ignores non-navigation keys and empty lists", async () => {
    const { computeRovingIndex } = await import("@/lib/use-roving-tabindex");

    assert.equal(computeRovingIndex("Escape", 0, 4), null);
    assert.equal(computeRovingIndex("Enter", 0, 4), null);
    assert.equal(computeRovingIndex("Tab", 0, 4), null);
    assert.equal(computeRovingIndex(" ", 0, 4), null);
    assert.equal(computeRovingIndex("1", 0, 4), null);
    assert.equal(computeRovingIndex("4", 3, 4), null);
    assert.equal(computeRovingIndex("ArrowRight", 0, 0), null);
  });

  test("keeps a single-item group on index 0", async () => {
    const { computeRovingIndex } = await import("@/lib/use-roving-tabindex");

    assert.equal(computeRovingIndex("ArrowRight", 0, 1), 0);
    assert.equal(computeRovingIndex("ArrowLeft", 0, 1), 0);
  });
});

describe("roving tabindex hook behavior", () => {
  type RovingTestEvent = {
    key: string;
    prevented: boolean;
    preventDefault: () => void;
  };

  function keyEvent(key: string) {
    const event: RovingTestEvent = {
      key,
      prevented: false,
      preventDefault() {
        event.prevented = true;
      },
    };
    return event;
  }

  test("handles Escape separately and navigates to the computed item", async () => {
    const { useRovingTabindex } = await import("@/lib/use-roving-tabindex");
    const focused: string[] = [];
    const items = ["a", "b", "c"].map((name) => ({
      focus: () => focused.push(name),
    }));
    const container = {
      querySelectorAll: (selector: string) => {
        assert.equal(selector, ".option");
        return items;
      },
    } as unknown as HTMLElement;
    const navigated: number[] = [];
    let escaped = 0;

    beginRender();
    const { handleKeyDown } = useRovingTabindex(
      { current: container },
      {
        selector: ".option",
        vertical: true,
        homeEnd: true,
        onEscape: () => escaped++,
        onNavigate: (index) => navigated.push(index),
      },
    );

    const escape = keyEvent("Escape");
    handleKeyDown(escape as never, 1);
    const arrow = keyEvent("ArrowDown");
    handleKeyDown(arrow as never, 1);
    const ignored = keyEvent("Enter");
    handleKeyDown(ignored as never, 1);

    assert.equal(escaped, 1);
    assert.equal(escape.prevented, true);
    assert.deepEqual(focused, ["c"]);
    assert.deepEqual(navigated, [2]);
    assert.equal(arrow.prevented, true);
    assert.equal(ignored.prevented, false);
  });

  test("returns without side effects when the container ref is empty", async () => {
    const { useRovingTabindex } = await import("@/lib/use-roving-tabindex");

    beginRender();
    const { handleKeyDown } = useRovingTabindex({ current: null });
    const event = keyEvent("ArrowRight");
    handleKeyDown(event as never, 0);

    assert.equal(event.prevented, false);
  });
});
