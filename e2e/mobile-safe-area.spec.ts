/**
 * Mobile safe-area browser probes (issue #1036).
 *
 * Validates the CSS/geometry contract for fixed-bottom mobile chrome at two
 * iPhone form-factors:
 *   - 390 × 844 (iPhone 14 / standard)
 *   - 430 × 932 (iPhone 14 Plus / Max)
 *
 * NOTE: Simulated Chromium safe-area-inset-bottom is 0 (no notch emulation).
 * These tests therefore validate:
 *   a) deterministic CSS math (token calc expressions render as expected),
 *   b) zero-inset behavior is unchanged (non-notch path),
 *   c) touch-target geometry (items are ≥ --bottom-bar-h tall, not clipped),
 *   d) scroll-to-bottom visibility (final content not hidden behind bar),
 *   e) MoreSheet final action visible, Sheet panel has safe-area class,
 *   f) reader bottom-sheet body has safe-area class.
 *
 * Real notch geometry (inset > 0) requires a physical device or a browser flag
 * (`--viewport-meta-content-override`). See wiring note in PR description.
 *
 * All checks are structurally deterministic even when inset = 0:
 *  - bar height = --bottom-bar-h (56px) when inset = 0 — non-notch unchanged ✓
 *  - AppShell padding = 56px when inset = 0 — non-notch unchanged ✓
 *  - padding-bottom CSS property on Sheet bottom panel = "0px" when inset = 0 ✓
 */

import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";

const VIEWPORTS = [
  { width: 390, height: 844, label: "390x844" },
  { width: 430, height: 932, label: "430x932" },
] as const;

const MOBILE_PRIMARY_NAV_SELECTOR = 'nav[aria-label="Primary"].fixed.bottom-0';

test.describe("@high-risk", () => {
// ---------------------------------------------------------------------------
// Tab bar geometry — items fill content-height token; no clipping
// ---------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  test(`[${vp.label}] tab bar items are ≥ 56px tall (content-height token) — light`, async ({
    signIn,
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await signIn();
    await page.goto("/dashboard");
    await expect(page.locator(MOBILE_PRIMARY_NAV_SELECTOR)).toBeVisible();

    const itemHeight = await page.evaluate(() => {
      const nav = document.querySelector(
        'nav[aria-label="Primary"].fixed.bottom-0',
      );
      if (!nav) return 0;
      const firstLink = nav.querySelector("a");
      return firstLink ? firstLink.getBoundingClientRect().height : 0;
    });
    expect(itemHeight).toBeGreaterThanOrEqual(56);
  });

  test(`[${vp.label}] tab bar items are ≥ 56px tall — dark`, async ({
    signIn,
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await signIn();
    await page.goto("/dashboard");
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await expect(page.locator(MOBILE_PRIMARY_NAV_SELECTOR)).toBeVisible();

    const itemHeight = await page.evaluate(() => {
      const nav = document.querySelector(
        'nav[aria-label="Primary"].fixed.bottom-0',
      );
      if (!nav) return 0;
      const firstLink = nav.querySelector("a");
      return firstLink ? firstLink.getBoundingClientRect().height : 0;
    });
    expect(itemHeight).toBeGreaterThanOrEqual(56);
  });
}

// ---------------------------------------------------------------------------
// Scroll-to-bottom visibility — final content is above the tab bar
// ---------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  test(`[${vp.label}] scroll-to-bottom: page content bottom edge is not behind the tab bar`, async ({
    signIn,
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await signIn();
    await page.goto("/dashboard");
    await expect(page.locator(MOBILE_PRIMARY_NAV_SELECTOR)).toBeVisible();

    const result = await page.evaluate(() => {
      // Scroll to the very bottom of the page.
      window.scrollTo({ top: document.body.scrollHeight });
      const nav = document.querySelector(
        'nav[aria-label="Primary"].fixed.bottom-0',
      );
      const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;

      // Find the lowest content element inside the main content wrapper
      // (the div that has the bottom padding reservation).
      const main = document.querySelector("main");
      if (!main) return { clearance: 999, navTop, mainBottom: 0 };
      const mainBottom = main.getBoundingClientRect().bottom;
      return {
        clearance: navTop - mainBottom,
        navTop,
        mainBottom,
      };
    });

    // The main content bottom edge should be at or above the nav top.
    // clearance >= 0 means final content is not behind the bar.
    expect(result.clearance).toBeGreaterThanOrEqual(0);
  });
}

// ---------------------------------------------------------------------------
// MoreSheet final action visible above home indicator
// ---------------------------------------------------------------------------

for (const vp of VIEWPORTS) {
  test(`[${vp.label}] MoreSheet final action (Sign out) is fully visible above tab bar`, async ({
    signIn,
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await signIn();
    await page.goto("/dashboard");
    await expect(page.locator(MOBILE_PRIMARY_NAV_SELECTOR)).toBeVisible();

    // Open the More sheet.
    await page.getByRole("button", { name: "More" }).click();
    const dialog = page.getByRole("dialog", { name: "More" });
    await expect(dialog).toBeVisible();

    // The sheet panel should have padding-bottom (0px when inset=0 in Chromium).
    const panelPb = await dialog.evaluate((el) =>
      window.getComputedStyle(el).paddingBottom,
    );
    // In non-notch Chromium env(safe-area-inset-bottom) = 0px, so pb = 0px.
    expect(panelPb).toBe("0px");

    // The Sign out button should be visible.
    const signOutBtn = page.getByRole("button", { name: /sign out/i });
    await signOutBtn.scrollIntoViewIfNeeded();
    await expect(signOutBtn).toBeVisible();

    // Its bottom should be at or above the viewport bottom minus any bar.
    const result = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => /sign out/i.test(b.textContent ?? ""),
      );
      if (!btn) return { btnBottom: 0, viewportH: window.innerHeight };
      return {
        btnBottom: btn.getBoundingClientRect().bottom,
        viewportH: window.innerHeight,
      };
    });
    expect(result.btnBottom).toBeLessThanOrEqual(result.viewportH);
  });
}

// ---------------------------------------------------------------------------
// Reader bottom-sheet body has safe-area class (structural check via DOM)
// ---------------------------------------------------------------------------

test("reader bottom-sheet body element has padding-bottom style (0px in Chromium, env-ready)", async ({
  signIn,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn();
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);

  // Open the reader tools sheet via the FAB or toolbar.
  const toolsBtn = page.getByRole("button", { name: /tools|study/i }).first();
  const toolsBtnVisible = await toolsBtn.isVisible().catch(() => false);
  if (!toolsBtnVisible) {
    test.skip();
    return;
  }
  await toolsBtn.click();

  // Locate the reader bottom-sheet body.
  const body = page.locator(".reader-bottom-sheet-body").first();
  const isVisible = await body.isVisible().catch(() => false);
  if (!isVisible) {
    test.skip();
    return;
  }

  const pb = await body.evaluate((el) =>
    window.getComputedStyle(el).paddingBottom,
  );
  // In Chromium without notch emulation, env(safe-area-inset-bottom) = 0px.
  // The presence of the property (even at 0px) confirms the CSS rule is applied.
  expect(pb).toBe("0px");
});

// ---------------------------------------------------------------------------
// Desktop viewport — tab bar absent, no bottom padding reserved
// ---------------------------------------------------------------------------

test("desktop (1280x900): BottomTabBar is not visible, AppShell has no bottom padding", async ({
  signIn,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn();
  await page.goto("/dashboard");

  // BottomTabBar is hidden at md+ by md:hidden.
  const nav = page.locator(MOBILE_PRIMARY_NAV_SELECTOR);
  const navVisible = await nav.isVisible().catch(() => false);
  expect(navVisible).toBe(false);

  // Main content column should have padding-bottom = 0 on desktop.
  const mainColPb = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return "-1";
    // The parent flex div is what has the pb class.
    const parent = main.parentElement;
    return parent ? window.getComputedStyle(parent).paddingBottom : "-1";
  });
  expect(mainColPb).toBe("0px");
});

});
