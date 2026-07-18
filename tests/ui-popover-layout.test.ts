import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { computeFloatingLayout } from "@/components/ui/floating-layout";

const GAP = 8;
const PADDING = 12;

describe("Floating layout", () => {
  test("centres a Reader surface without entering the mini-player safe area", () => {
    const layout = computeFloatingLayout({
      anchorRect: { top: 700, right: 195, bottom: 700, left: 195 },
      floatingWidth: 340,
      floatingHeight: 200,
      viewport: { left: 0, top: 0, width: 390, height: 844 },
      preferredPlacement: "below",
      align: "center",
      gap: 12,
      viewportPadding: 12,
      safeArea: { bottom: 56 },
    });

    assert.equal(layout.placement, "above");
    assert.equal(layout.left, 25);
    assert.ok(layout.top + 200 <= 844 - 56 - PADDING);
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
