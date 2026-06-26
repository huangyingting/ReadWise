/**
 * E2E: bookmark toggle flow.
 *
 * Seeds the smoke article and opens it as a Reader. Exercises the
 * "Save to reading list" toggle button in the article header, verifying that
 * clicking it flips the aria-pressed state (optimistic UI) and that a second
 * click restores the original state.
 */
import { expect, test } from "@playwright/test";
import {
  addSessionCookie,
  createUserWithSession,
  disconnectDb,
  seedSmokeData,
  TEST_ARTICLE_ID,
} from "./support/seed";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  await seedSmokeData();
});

test.afterAll(async () => {
  await disconnectDb();
});

test("bookmark toggle: saves and then un-saves an article", async ({ context, page }) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(
    page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
  ).toBeVisible();

  const saveBtn = page.getByRole("button", { name: "Save to reading list" });
  await expect(saveBtn).toBeVisible();

  // Initially the article is not saved (aria-pressed=false)
  await expect(saveBtn).toHaveAttribute("aria-pressed", "false");

  // Click to save
  await saveBtn.click();
  await expect(saveBtn).toHaveAttribute("aria-pressed", "true");

  // Click again to remove
  await saveBtn.click();
  await expect(saveBtn).toHaveAttribute("aria-pressed", "false");
});

test("bookmark group is visible on the article page", async ({ context, page }) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(page.getByRole("group", { name: "Bookmark controls" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save to reading list" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to list" })).toBeVisible();
});
