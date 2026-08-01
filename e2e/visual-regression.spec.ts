/**
 * Limited visual-regression baseline for stable product surfaces.
 *
 * This suite is opt-in by policy: set PLAYWRIGHT_VISUAL_REGRESSION=1 locally or
 * in a non-blocking CI job before running/updating snapshots.
 */
import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";
import type { Page } from "@playwright/test";

const RUN_VISUAL_REGRESSION = process.env.PLAYWRIGHT_VISUAL_REGRESSION === "1";
const SCREENSHOT_OPTIONS = {
  animations: "disabled",
  caret: "hide",
  maxDiffPixelRatio: 0.01,
} as const;

test.setTimeout(300_000);

async function stabilize(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-delay: 0s !important;
        transition-duration: 0.01ms !important;
        transition-delay: 0s !important;
      }
    `,
  });
  await page.evaluate(() => document.fonts.ready);
}

async function isolateMainFromStickyChrome(page: Page) {
  const appHeader = page.getByRole("banner").first();
  await appHeader.evaluate((element) => {
    (element as HTMLElement).style.position = "static";
  });
}

test.describe("visual regression baseline", () => {
  test.skip(
    !RUN_VISUAL_REGRESSION,
    "Visual regression is opt-in; set PLAYWRIGHT_VISUAL_REGRESSION=1.",
  );

  test.use({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
  });

  test("sign-in surface", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByRole("heading", { name: "Sign in to ReadWise" })).toBeVisible();
    await stabilize(page);

    await expect(page.locator("main")).toHaveScreenshot(
      "signin-desktop.png",
      SCREENSHOT_OPTIONS,
    );
  });

  test("dashboard surface", async ({ readerPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await stabilize(page);

    await expect(page.locator("main")).toHaveScreenshot(
      "dashboard-desktop.png",
      SCREENSHOT_OPTIONS,
    );
  });

  test("reader surface", async ({ readerPage: page }) => {
    await page.goto(`/reader/${TEST_ARTICLE_ID}`);
    await expect(
      page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
    ).toBeVisible();
    await stabilize(page);

    await expect(page.locator("main")).toHaveScreenshot(
      "reader-desktop.png",
      SCREENSHOT_OPTIONS,
    );
  });

  test("admin surface", async ({ adminPage: page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await stabilize(page);

    await expect(page.locator("main")).toHaveScreenshot(
      "admin-desktop.png",
      SCREENSHOT_OPTIONS,
    );
  });

  test("teacher surface", async ({ readerPage: page }) => {
    await page.goto("/teacher");
    await expect(page.getByRole("heading", { name: "Teaching" })).toBeVisible();
    await expect(page.getByText("No archived classrooms", { exact: true })).toBeVisible();
    await stabilize(page);
    // The baseline targets <main>, not the global app chrome. Once the teacher
    // surface became taller than the viewport, Playwright scrolled <main> to
    // capture it and the sticky banner painted over the page heading.
    await isolateMainFromStickyChrome(page);

    await expect(page.locator("main")).toHaveScreenshot(
      "teacher-desktop.png",
      SCREENSHOT_OPTIONS,
    );
  });
});
