import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { beginRender } from "./support/react-hook-harness";

describe("roving tabindex hook behavior", () => {
  type RovingTestEvent = {
    key: string;
    currentTarget?: unknown;
    defaultPrevented: boolean;
    prevented: boolean;
    preventDefault: () => void;
  };

  function keyEvent(key: string, currentTarget?: unknown) {
    const event: RovingTestEvent = {
      key,
      currentTarget,
      defaultPrevented: false,
      prevented: false,
      preventDefault() {
        event.defaultPrevented = true;
        event.prevented = true;
      },
    };
    return event;
  }

  function rovingItems(
    names: string[],
    activeIndex: number,
    disabledIndices: number[] = [],
    ariaDisabledIndices: number[] = [],
  ) {
    const focused: string[] = [];
    const items = names.map((name, index) => ({
      tabIndex: index === activeIndex ? 0 : -1,
      disabled: disabledIndices.includes(index),
      getAttribute: (attribute: string) =>
        attribute === "aria-disabled" && ariaDisabledIndices.includes(index)
          ? "true"
          : null,
      focus: () => focused.push(name),
    }));
    const container = {
      querySelectorAll: () => items,
    } as unknown as HTMLElement;
    return { container, focused, items };
  }

  test("moves horizontally, wraps, and owns tabindex state", async () => {
    const { useRovingTabindex } = await import("@/lib/use-roving-tabindex");
    const { container, focused, items } = rovingItems(["a", "b", "c"], 2);

    beginRender();
    const { handleKeyDown } = useRovingTabindex({ current: container });
    const forward = keyEvent("ArrowRight", items[2]);
    handleKeyDown(forward as never);
    const backward = keyEvent("ArrowLeft", items[0]);
    handleKeyDown(backward as never);

    assert.deepEqual(focused, ["a", "c"]);
    assert.deepEqual(items.map((item) => item.tabIndex), [-1, -1, 0]);
    assert.equal(forward.prevented, true);
    assert.equal(backward.prevented, true);
  });

  test("supports configured orientation, Home, and End", async () => {
    const { useRovingTabindex } = await import("@/lib/use-roving-tabindex");
    const { container, focused, items } = rovingItems(["a", "b", "c"], 1);

    beginRender();
    const { handleKeyDown } = useRovingTabindex(
      { current: container },
      { orientation: "vertical", homeEnd: true },
    );
    handleKeyDown(keyEvent("ArrowDown", items[1]) as never);
    handleKeyDown(keyEvent("Home", items[2]) as never);
    handleKeyDown(keyEvent("End", items[0]) as never);
    const ignored = keyEvent("ArrowRight", items[2]);
    handleKeyDown(ignored as never);

    assert.deepEqual(focused, ["c", "a", "c"]);
    assert.equal(ignored.prevented, false);
  });

  test("skips disabled items and reports the original item index", async () => {
    const { useRovingTabindex } = await import("@/lib/use-roving-tabindex");
    const { container, focused, items } = rovingItems(
      ["a", "b", "c", "d"],
      0,
      [1],
      [2],
    );
    const navigated: number[] = [];

    beginRender();
    const { handleKeyDown } = useRovingTabindex(
      { current: container },
      { onNavigate: (index) => navigated.push(index) },
    );
    handleKeyDown(keyEvent("ArrowRight", items[0]) as never);

    assert.deepEqual(focused, ["d"]);
    assert.deepEqual(navigated, [3]);
    assert.deepEqual(items.map((item) => item.tabIndex), [-1, -1, -1, 0]);
  });

  test("handles Escape only when the caller provides an action", async () => {
    const { useRovingTabindex } = await import("@/lib/use-roving-tabindex");
    const { container, items } = rovingItems(["a"], 0);
    let escaped = 0;

    beginRender();
    const { handleKeyDown } = useRovingTabindex(
      { current: container },
      { onEscape: () => escaped++ },
    );
    const handled = keyEvent("Escape", items[0]);
    handleKeyDown(handled as never);

    assert.equal(escaped, 1);
    assert.equal(handled.prevented, true);
  });

  test("respects a prior keyboard handler that prevented the event", async () => {
    const { useRovingTabindex } = await import("@/lib/use-roving-tabindex");
    const { container, focused, items } = rovingItems(["a", "b"], 0);

    beginRender();
    const { handleKeyDown } = useRovingTabindex({ current: container });
    const event = keyEvent("ArrowRight", items[0]);
    event.preventDefault();
    handleKeyDown(event as never);

    assert.deepEqual(focused, []);
  });

  test("returns without side effects when the container ref is empty", async () => {
    const { useRovingTabindex } = await import("@/lib/use-roving-tabindex");

    beginRender();
    const { handleKeyDown } = useRovingTabindex({ current: null });
    const event = keyEvent("ArrowRight");
    handleKeyDown(event as never);

    assert.equal(event.prevented, false);
  });
});
