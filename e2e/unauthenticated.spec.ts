/**
 * E2E: unauthenticated redirect guards.
 *
 * Verifies that every protected route (dashboard, reader, browse, study)
 * redirects an unauthenticated visitor to the sign-in page.
 * No user session is set up — cookies are cleared before each test.
 */
import { expect, test } from "@playwright/test";
import { disconnectDb, seedSmokeData } from "./support/seed";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  await seedSmokeData();
});

test.afterAll(async () => {
  await disconnectDb();
});

test("unauthenticated user is redirected to signin from /dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin/);
});

test("unauthenticated user is redirected to signin from /browse", async ({ page }) => {
  await page.goto("/browse");
  await expect(page).toHaveURL(/\/signin/);
});

test("unauthenticated user is redirected to signin from /reader/:id", async ({ page }) => {
  await page.goto("/reader/any-article-id");
  await expect(page).toHaveURL(/\/signin/);
});

test("unauthenticated user is redirected to signin from /study", async ({ page }) => {
  await page.goto("/study");
  await expect(page).toHaveURL(/\/signin/);
});

test("unauthenticated user is redirected to signin from /progress", async ({ page }) => {
  await page.goto("/progress");
  await expect(page).toHaveURL(/\/signin/);
});
