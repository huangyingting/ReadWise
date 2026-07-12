import { expect, test, TEST_ARTICLE_ID } from "./support/fixtures";
import type { Page } from "@playwright/test";

const THEME_STORAGE_KEY = "readwise:theme";
const LANDSCAPE_PHONE_VIEWPORT = { width: 667, height: 375 } as const;
const PHONE_VIEWPORT = { width: 390, height: 844 } as const;
const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const THEMES = ["light", "dark"] as const;

type Theme = (typeof THEMES)[number];

async function configurePresentation(
  page: Page,
  viewport: { width: number; height: number },
  theme: Theme,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(
    ({ key, nextTheme }) => {
      window.localStorage.setItem(key, nextTheme);
    },
    { key: THEME_STORAGE_KEY, nextTheme: theme },
  );
}

async function popoverMetrics(page: Page, label: string) {
  const popover = page.getByRole("dialog", { name: label });
  await expect(popover).toBeVisible();
  return popover.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const style = getComputedStyle(element);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: style.overflowY,
      viewportLeft,
      viewportTop,
      viewportRight,
      viewportBottom,
    };
  });
}

test.describe("@high-risk", () => {
for (const theme of THEMES) {
  test(`reader display settings popover fits viewport or scrolls (${theme}, 667x375)`, async ({
    readerPage: page,
  }) => {
    await configurePresentation(page, LANDSCAPE_PHONE_VIEWPORT, theme);
    await page.goto(`/reader/${TEST_ARTICLE_ID}`);
    await expect(
      page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Display settings" }).click();
    const popover = page.getByRole("dialog", { name: "Display settings" });
    const metrics = await popoverMetrics(page, "Display settings");
    const withinViewport =
      metrics.top >= metrics.viewportTop - 0.5 &&
      metrics.bottom <= metrics.viewportBottom + 0.5;
    const internallyScrollable =
      metrics.scrollHeight > metrics.clientHeight + 1 &&
      (metrics.overflowY === "auto" || metrics.overflowY === "scroll");

    expect(withinViewport || internallyScrollable).toBeTruthy();

    const spacious = popover.getByRole("radio", { name: "Spacious" });
    await spacious.scrollIntoViewIfNeeded();
    await expect(spacious).toBeVisible();
    await spacious.click();
    await expect(spacious).toHaveAttribute("aria-checked", "true");
  });
}

for (const theme of THEMES) {
  const presentations = [
    { name: "phone", viewport: PHONE_VIEWPORT },
    { name: "desktop", viewport: DESKTOP_VIEWPORT },
  ] as const;

  for (const presentation of presentations) {
    test(`user menu popover stays clamped (${theme}, ${presentation.name})`, async ({
      readerPage: page,
    }) => {
      await configurePresentation(page, presentation.viewport, theme);
      await page.goto("/dashboard");
      const trigger = page.getByRole("button", { name: "User menu" });
      await trigger.click();

      const metrics = await popoverMetrics(page, "User menu");

      expect(metrics.left).toBeGreaterThanOrEqual(metrics.viewportLeft - 0.5);
      expect(metrics.right).toBeLessThanOrEqual(metrics.viewportRight + 0.5);
      expect(metrics.top).toBeGreaterThanOrEqual(metrics.viewportTop - 0.5);
      expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportBottom + 0.5);

      const shortcuts = page.getByRole("menuitem", { name: "Keyboard shortcuts" });
      await expect(shortcuts).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "User menu" })).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
}

});
