import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";
import type { Page } from "@playwright/test";

const ARTICLE_HEADING = "E2E Critical Reading Smoke Article";

const ORIENTATIONS = [
  { name: "portrait", viewport: { width: 390, height: 844 } },
  { name: "landscape", viewport: { width: 667, height: 375 } },
] as const;

async function gotoSeededReader(page: Page) {
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(page.getByRole("heading", { name: ARTICLE_HEADING })).toBeVisible();
}

async function probeRootGeometry(page: Page) {
  return page.evaluate(() => {
    const root = document.getElementById("reader-root");
    if (!root) throw new Error("Missing #reader-root");
    const rootStyle = getComputedStyle(root);

    return {
      viewportHeight: window.innerHeight,
      minHeight: Number.parseFloat(rootStyle.minHeight),
      rootTop: root.getBoundingClientRect().top,
      windowScrollY: window.scrollY,
      documentScrollTop: document.documentElement.scrollTop,
      scrollingElementTag: document.scrollingElement?.tagName ?? null,
      bodyOverflowStyle: document.body.style.overflow,
    };
  });
}

for (const orientation of ORIENTATIONS) {
  test(`reader root viewport sizing stays stable on ${orientation.name}`, async ({
    signIn,
    page,
  }) => {
    await page.setViewportSize(orientation.viewport);
    await signIn();
    await gotoSeededReader(page);

    const backControl = page.getByRole("link", { name: /back/i });
    const displayControl = page.getByRole("button", { name: "Display settings", exact: true });
    const toolsControl = page.getByRole("button", { name: "Practice tools", exact: true });

    await expect(backControl).toBeVisible();
    await expect(displayControl).toBeVisible();
    await expect(toolsControl).toBeVisible();

    const controls = [backControl, displayControl, toolsControl];
    const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
    for (const box of boxes) {
      expect(box).not.toBeNull();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(orientation.viewport.height);
      expect(box?.y ?? 0).toBeGreaterThanOrEqual(0);
    }

    const before = await probeRootGeometry(page);
    expect(Math.abs(before.minHeight - before.viewportHeight)).toBeLessThanOrEqual(1);
    expect(before.rootTop).toBeGreaterThanOrEqual(0);
    expect(before.windowScrollY).toBe(0);
    expect(before.documentScrollTop).toBe(0);
    expect(before.scrollingElementTag).toBe("HTML");
    expect(before.bodyOverflowStyle).toBe("");

    await toolsControl.click();
    await expect(page.getByRole("dialog", { name: "Practice tools" })).toBeVisible();
    await expect(page.getByLabel("Close practice tools")).toBeVisible();

    const duringOverlay = await page.evaluate(() => document.body.style.overflow);
    expect(duringOverlay).toBe("hidden");

    await page.getByLabel("Close practice tools").click();
    await expect(page.getByRole("dialog", { name: "Practice tools" })).toBeHidden();

    const after = await probeRootGeometry(page);
    expect(Math.abs(after.minHeight - after.viewportHeight)).toBeLessThanOrEqual(1);
    expect(after.windowScrollY).toBe(0);
    expect(after.documentScrollTop).toBe(0);
    expect(after.bodyOverflowStyle).toBe("");
  });
}
