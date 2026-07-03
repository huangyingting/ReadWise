import { before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { beginRender } from "./support/react-hook-harness";

let rovingModule: Awaited<typeof import("@/lib/use-roving-tabindex")>;

before(async () => {
  rovingModule = await import("@/lib/use-roving-tabindex");
});

type RovingCase = {
  key: Parameters<typeof import("@/lib/use-roving-tabindex").computeRovingIndex>[0];
  current: number;
  total: number;
  options?: Parameters<typeof import("@/lib/use-roving-tabindex").computeRovingIndex>[3];
  expected: number | null;
};

function assertRovingCases(cases: RovingCase[]) {
  for (const { key, current, total, options, expected } of cases) {
    const { computeRovingIndex } = rovingModule;
    assert.equal(computeRovingIndex(key, current, total, options), expected);
  }
}

describe("computeRovingIndex", () => {
  test("handles horizontal arrow navigation and wrapping", () => {
    const total = 4;

    assertRovingCases([
      { key: "ArrowRight", current: 0, total, expected: 1 },
      { key: "ArrowRight", current: 2, total, expected: 3 },
      { key: "ArrowRight", current: 3, total, expected: 0 },
      { key: "ArrowLeft", current: 2, total, expected: 1 },
      { key: "ArrowLeft", current: 3, total, expected: 2 },
      { key: "ArrowLeft", current: 0, total, expected: 3 },
    ]);
  });

  test("gates vertical and Home/End navigation behind options", () => {
    const total = 4;

    assertRovingCases([
      { key: "ArrowDown", current: 1, total, expected: null },
      { key: "ArrowUp", current: 1, total, expected: null },
      { key: "ArrowDown", current: 1, total, options: { vertical: true }, expected: 2 },
      { key: "ArrowDown", current: 3, total, options: { vertical: true }, expected: 0 },
      { key: "ArrowUp", current: 2, total, options: { vertical: true }, expected: 1 },
      { key: "ArrowUp", current: 0, total, options: { vertical: true }, expected: 3 },
      { key: "Home", current: 3, total, expected: null },
      { key: "End", current: 0, total, expected: null },
      { key: "Home", current: 3, total, options: { homeEnd: true }, expected: 0 },
      { key: "Home", current: 0, total, options: { homeEnd: true }, expected: 0 },
      { key: "End", current: 0, total, options: { homeEnd: true }, expected: 3 },
      { key: "End", current: 3, total, options: { homeEnd: true }, expected: 3 },
    ]);
  });

  test("ignores non-navigation keys and empty lists", () => {
    assertRovingCases([
      { key: "Escape", current: 0, total: 4, expected: null },
      { key: "Enter", current: 0, total: 4, expected: null },
      { key: "Tab", current: 0, total: 4, expected: null },
      { key: " ", current: 0, total: 4, expected: null },
      { key: "1", current: 0, total: 4, expected: null },
      { key: "4", current: 3, total: 4, expected: null },
      { key: "ArrowRight", current: 0, total: 0, expected: null },
    ]);
  });

  test("keeps a single-item group on index 0", () => {
    assertRovingCases([
      { key: "ArrowRight", current: 0, total: 1, expected: 0 },
      { key: "ArrowLeft", current: 0, total: 1, expected: 0 },
    ]);
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
