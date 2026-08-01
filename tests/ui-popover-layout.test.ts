import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { computeFloatingLayout } from "@/components/ui/floating-layout";
import { resolveCssLengthPx } from "@/components/ui/useFloatingPosition";

const GAP = 8;
const PADDING = 12;

describe("Floating layout", () => {
  test("centres a Reader surface without entering the resolved mini-player safe area", () => {
    const layout = computeFloatingLayout({
      anchorRect: { top: 700, right: 195, bottom: 700, left: 195 },
      floatingWidth: 340,
      floatingHeight: 200,
      viewport: { left: 0, top: 0, width: 390, height: 844 },
      preferredPlacement: "below",
      align: "center",
      gap: 12,
      viewportPadding: 12,
      safeArea: { bottom: 80 },
    });

    assert.equal(layout.placement, "above");
    assert.equal(layout.left, 25);
    assert.ok(layout.top + 200 <= 844 - 80 - PADDING);
  });

  test("resolves a scoped calc-based safe-area token to pixels", () => {
    let removed = false;
    const probeStyle: Record<string, string> = {};
    const probe = {
      style: probeStyle,
      remove: () => {
        removed = true;
      },
    } as unknown as HTMLElement;
    let scope: HTMLElement;
    const view = {
      getComputedStyle(element: Element) {
        if (element === scope) {
          return {
            getPropertyValue: (property: string) =>
              property === "--reader-mini-player-height"
                ? "calc(56px + env(safe-area-inset-bottom, 0px))"
                : "",
          };
        }
        return { height: "80px" };
      },
    } as unknown as Window;
    const ownerDocument = {
      defaultView: view,
      createElement: () => probe,
    } as unknown as Document;
    scope = {
      ownerDocument,
      appendChild: (element: Node) => {
        assert.equal(element, probe);
        return element;
      },
    } as unknown as HTMLElement;

    assert.equal(
      resolveCssLengthPx(scope, "--reader-mini-player-height", 56),
      80,
    );
    assert.equal(probeStyle.height, "var(--reader-mini-player-height)");
    assert.equal(removed, true);
  });

  test("resolves px and rem tokens and fails closed to the supplied fallback", () => {
    const root = {} as HTMLElement;
    let scope: HTMLElement;
    const values = new Map<string, string>([
      ["--pixel", " 12.5px "],
      ["--root", "1.5rem"],
      ["--missing", ""],
      ["--invalid-root", "2rem"],
    ]);
    const view = {
      getComputedStyle(element: Element) {
        if (element === root) return { fontSize: "16px" };
        if (element === scope) {
          return {
            getPropertyValue: (property: string) => values.get(property) ?? "",
          };
        }
        return { height: "not-a-length" };
      },
    } as unknown as Window;
    const probe = {
      style: {},
      remove: () => {},
    } as unknown as HTMLElement;
    const ownerDocument = {
      defaultView: view,
      documentElement: root,
      createElement: () => probe,
    } as unknown as Document;
    scope = {
      ownerDocument,
      appendChild: (element: Node) => element,
    } as unknown as HTMLElement;

    assert.equal(resolveCssLengthPx(scope, "--pixel", 3), 12.5);
    assert.equal(resolveCssLengthPx(scope, "--root", 3), 24);
    assert.equal(resolveCssLengthPx(scope, "--missing", 3), 3);

    const noView = {
      ownerDocument: { defaultView: null },
    } as unknown as HTMLElement;
    assert.equal(resolveCssLengthPx(noView, "--pixel", 7), 7);

    (view.getComputedStyle as (element: Element) => unknown) = (element: Element) => {
      if (element === root) return { fontSize: "invalid" };
      if (element === scope) {
        return { getPropertyValue: () => values.get("--invalid-root") };
      }
      return { height: "not-a-length" };
    };
    assert.equal(resolveCssLengthPx(scope, "--invalid-root", 9), 9);

    values.set("--computed", "calc(1px + 2%)");
    assert.equal(resolveCssLengthPx(scope, "--computed", 11), 11);
  });

  test("clamps a right-side tooltip without changing its preferred side", () => {
    const layout = computeFloatingLayout({
      anchorRect: { top: 40, right: 95, bottom: 60, left: 85 },
      floatingWidth: 30,
      floatingHeight: 20,
      viewport: { left: 0, top: 0, width: 100, height: 100 },
      preferredPlacement: "right",
      align: "center",
      gap: 6,
      viewportPadding: 4,
      flip: false,
    });

    assert.equal(layout.placement, "right");
    assert.equal(layout.left, 66);
    assert.equal(layout.top, 40);
  });
});

describe("Popover viewport layout", () => {
  test("keeps preferred below placement when content fits", () => {
    const layout = computeFloatingLayout({
      anchorRect: { top: 80, right: 320, bottom: 112, left: 288 },
      floatingWidth: 240,
      floatingHeight: 150,
      viewport: { left: 0, top: 0, width: 667, height: 375 },
      preferredPlacement: "below",
      align: "end",
      gap: GAP,
      viewportPadding: PADDING,
    });

    assert.equal(layout.placement, "below");
    assert.equal(layout.scrollable, false);
    assert.equal(layout.top, 120);
  });

  test("flips above when below space is insufficient and above fits", () => {
    const layout = computeFloatingLayout({
      anchorRect: { top: 330, right: 530, bottom: 362, left: 498 },
      floatingWidth: 240,
      floatingHeight: 180,
      viewport: { left: 0, top: 0, width: 667, height: 375 },
      preferredPlacement: "below",
      align: "end",
      gap: GAP,
      viewportPadding: PADDING,
    });

    assert.equal(layout.placement, "above");
    assert.equal(layout.scrollable, false);
    assert.equal(layout.top, 142);
  });

  test("landscape reader case stays inside viewport by enabling internal scroll", () => {
    const layout = computeFloatingLayout({
      anchorRect: { top: 147, right: 530, bottom: 179, left: 498 },
      floatingWidth: 260,
      floatingHeight: 304.88,
      viewport: { left: 0, top: 0, width: 667, height: 375 },
      preferredPlacement: "below",
      align: "end",
      gap: GAP,
      viewportPadding: PADDING,
    });

    const viewportBottom = 375 - PADDING;
    const renderedBottom = layout.top + layout.maxHeight;

    assert.equal(layout.placement, "below");
    assert.equal(layout.maxHeight, 176);
    assert.equal(layout.scrollable, true);
    assert.ok(
      renderedBottom <= viewportBottom + 0.01,
      `popover bottom ${renderedBottom} should stay within ${viewportBottom}`,
    );
  });

  test("preserves a stricter authored content size cap", () => {
    const layout = computeFloatingLayout({
      anchorRect: { top: 400, right: 520, bottom: 420, left: 480 },
      floatingWidth: 600,
      floatingHeight: 700,
      viewport: { left: 0, top: 0, width: 1000, height: 800 },
      preferredPlacement: "below",
      align: "center",
      gap: GAP,
      viewportPadding: PADDING,
      sizeLimit: { width: 320, height: 300 },
    });

    assert.equal(layout.placement, "below");
    assert.equal(layout.maxWidth, 320);
    assert.equal(layout.maxHeight, 300);
    assert.equal(layout.scrollable, true);
  });

  test("clamps horizontal position for end-aligned trigger near the left edge", () => {
    const layout = computeFloatingLayout({
      anchorRect: { top: 100, right: 40, bottom: 132, left: 8 },
      floatingWidth: 260,
      floatingHeight: 120,
      viewport: { left: 0, top: 0, width: 375, height: 667 },
      preferredPlacement: "below",
      align: "end",
      gap: GAP,
      viewportPadding: PADDING,
    });

    assert.equal(layout.left, 12);
  });

  test("clamps horizontal position for start-aligned trigger near the right edge", () => {
    const layout = computeFloatingLayout({
      anchorRect: { top: 100, right: 360, bottom: 132, left: 340 },
      floatingWidth: 260,
      floatingHeight: 120,
      viewport: { left: 0, top: 0, width: 375, height: 667 },
      preferredPlacement: "below",
      align: "start",
      gap: GAP,
      viewportPadding: PADDING,
    });

    assert.equal(layout.left, 103);
  });
});
