import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { computePopoverLayout } from "@/components/ui/popover-layout";

const GAP = 8;
const PADDING = 12;

describe("Popover viewport layout", () => {
  test("keeps preferred below placement when content fits", () => {
    const layout = computePopoverLayout({
      anchorRect: { top: 80, right: 320, bottom: 112, left: 288 },
      panelWidth: 240,
      panelHeight: 150,
      viewport: { left: 0, top: 0, width: 667, height: 375 },
      align: "end",
      gap: GAP,
      viewportPadding: PADDING,
    });

    assert.equal(layout.placement, "below");
    assert.equal(layout.scrollable, false);
    assert.equal(layout.top, 120);
  });

  test("flips above when below space is insufficient and above fits", () => {
    const layout = computePopoverLayout({
      anchorRect: { top: 330, right: 530, bottom: 362, left: 498 },
      panelWidth: 240,
      panelHeight: 180,
      viewport: { left: 0, top: 0, width: 667, height: 375 },
      align: "end",
      gap: GAP,
      viewportPadding: PADDING,
    });

    assert.equal(layout.placement, "above");
    assert.equal(layout.scrollable, false);
    assert.equal(layout.top, 142);
  });

  test("landscape reader case stays inside viewport by enabling internal scroll", () => {
    const layout = computePopoverLayout({
      anchorRect: { top: 147, right: 530, bottom: 179, left: 498 },
      panelWidth: 260,
      panelHeight: 304.88,
      viewport: { left: 0, top: 0, width: 667, height: 375 },
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

  test("clamps horizontal position for end-aligned trigger near the left edge", () => {
    const layout = computePopoverLayout({
      anchorRect: { top: 100, right: 40, bottom: 132, left: 8 },
      panelWidth: 260,
      panelHeight: 120,
      viewport: { left: 0, top: 0, width: 375, height: 667 },
      align: "end",
      gap: GAP,
      viewportPadding: PADDING,
    });

    assert.equal(layout.left, 12);
  });

  test("clamps horizontal position for start-aligned trigger near the right edge", () => {
    const layout = computePopoverLayout({
      anchorRect: { top: 100, right: 360, bottom: 132, left: 340 },
      panelWidth: 260,
      panelHeight: 120,
      viewport: { left: 0, top: 0, width: 375, height: 667 },
      align: "start",
      gap: GAP,
      viewportPadding: PADDING,
    });

    assert.equal(layout.left, 103);
  });
});
