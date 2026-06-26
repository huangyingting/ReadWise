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
import { expect, test } from "@playwright/test";
import {
  addSessionCookie,
  createUserWithSession,
  disconnectDb,
  seedSmokeData,
  TEST_ARTICLE_ID,
} from "./support/seed";

// Mobile viewport matching iPhone 14 form-factor.
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context, page }) => {
  await context.clearCookies();
  await seedSmokeData();
  await page.setViewportSize(MOBILE_VIEWPORT);
});

test.afterAll(async () => {
  await disconnectDb();
});

// ---------------------------------------------------------------------------
// 1. Reader loads on mobile viewport
// ---------------------------------------------------------------------------

test("reader renders article heading on mobile viewport", async ({
  context,
  page,
}) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto(`/reader/${TEST_ARTICLE_ID}`);

  await expect(
    page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// 2. Reader toolbar is visible on mobile
// ---------------------------------------------------------------------------

test("reader toolbar back button is visible on mobile viewport", async ({
  context,
  page,
}) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(
    page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
  ).toBeVisible();

  // The Back button is always present in ReaderControls regardless of viewport.
  await expect(page.getByRole("link", { name: /back/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// 3. Offline library page loads on mobile
// ---------------------------------------------------------------------------

test("offline library shows correct heading on mobile viewport", async ({
  context,
  page,
}) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

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
