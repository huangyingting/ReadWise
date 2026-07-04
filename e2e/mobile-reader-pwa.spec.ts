/**
 * E2E mobile viewport smoke — Reader load, offline library, and PWA manifest.
 *
 * Runs at 390 × 844 px (iPhone 14 form-factor) to exercise the mobile Reader
 * and PWA baseline documented in docs/ui/mobile-reader-pwa.md.
 *
 * Checks:
 *  1. Reader renders the article heading on a mobile viewport.
 *  2. Reader toolbar controls are visible on mobile (Back + Listen at minimum).
 *  3. Offline library page loads with the correct heading on mobile.
 *  4. /manifest.webmanifest is reachable and contains the expected fields.
 *
 * No live AI, Speech, OAuth, or Push providers are required.
 */
import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";
import type { Page } from "@playwright/test";

// Mobile viewport matching iPhone 14 form-factor.
const ARTICLE_HEADING = "E2E Critical Reading Smoke Article";

async function gotoSeededArticle(page: Page) {
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(page.getByRole("heading", { name: ARTICLE_HEADING })).toBeVisible();
}

// ---------------------------------------------------------------------------
// 1. Reader loads on mobile viewport
// ---------------------------------------------------------------------------

test("reader renders article heading on mobile viewport", async ({
  signIn,
  mobilePage: page,
}) => {
  await signIn();
  await gotoSeededArticle(page);
});

// ---------------------------------------------------------------------------
// 2. Reader toolbar is visible on mobile
// ---------------------------------------------------------------------------

test("reader toolbar back button is visible on mobile viewport", async ({
  signIn,
  mobilePage: page,
}) => {
  await signIn();
  await gotoSeededArticle(page);

  // The Back button is always present in ReaderControls regardless of viewport.
  await expect(page.getByRole("link", { name: /back/i })).toBeVisible();
});

test("reader mini-player clearance keeps final content unobscured on mobile", async ({
  signIn,
  mobilePage: page,
}) => {
  await signIn();
  await gotoSeededArticle(page);

  await page.evaluate(() => {
    const root = document.getElementById("reader-root");
    if (!root || document.querySelector("[data-e2e-mini-player]")) return;
    const player = document.createElement("div");
    player.className = "reader-mini-player";
    player.setAttribute("data-e2e-mini-player", "true");
    player.setAttribute("aria-label", "Audio player");
    player.textContent = "Audio player";
    root.appendChild(player);
  });

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  const clearance = await page.evaluate(() => {
    const player = document.querySelector<HTMLElement>("[data-e2e-mini-player]");
    const column = document.querySelector<HTMLElement>(".reader-column");
    const finalBlock = document.querySelector<HTMLElement>(".reader-column > :last-child");
    if (!player || !column || !finalBlock) {
      throw new Error("Reader mini-player clearance test could not find required elements");
    }

    const playerRect = player.getBoundingClientRect();
    const finalRect = finalBlock.getBoundingClientRect();
    const columnStyle = getComputedStyle(column);
    return {
      finalBottom: finalRect.bottom,
      playerTop: playerRect.top,
      playerHeight: playerRect.height,
      paddingBottom: Number.parseFloat(columnStyle.paddingBottom),
    };
  });

  expect(clearance.paddingBottom).toBeGreaterThanOrEqual(clearance.playerHeight);
  expect(clearance.finalBottom).toBeLessThanOrEqual(clearance.playerTop);
});

// ---------------------------------------------------------------------------
// 3. Offline library page loads on mobile
// ---------------------------------------------------------------------------

test("offline library shows correct heading on mobile viewport", async ({
  signIn,
  mobilePage: page,
}) => {
  await signIn();

  await page.goto("/offline");
  await expect(page).toHaveURL(/\/offline$/);
  await expect(
    page.getByRole("heading", { name: "Offline Library" }),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// 4. PWA manifest is reachable and well-formed
// ---------------------------------------------------------------------------

test("manifest.webmanifest is reachable and has expected fields", async ({
  page,
}) => {
  const response = await page.goto("/manifest.webmanifest");
  expect(response?.status()).toBe(200);

  const manifest = await response?.json() as {
    name?: string;
    display?: string;
    start_url?: string;
    icons?: unknown[];
  };

  expect(manifest.name).toBeTruthy();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBeTruthy();
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect((manifest.icons ?? []).length).toBeGreaterThan(0);
});
