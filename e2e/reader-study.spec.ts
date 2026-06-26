/**
 * E2E: reader practice-tools flow — quiz panel + vocabulary save/review.
 *
 * Seeds the smoke article and opens it as a Reader.  Exercises the "Practice
 * tools" toolbar button, verifying that the quiz and words tabs open correctly.
 * Because the CI environment has no AI configured, the quiz shows a graceful
 * empty/loading state and the vocabulary panel shows the words tab; the test
 * does not depend on AI-generated content.
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

test("opens the Practice tools panel and shows the quiz tab", async ({ context, page }) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(
    page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
  ).toBeVisible();

  // Open Practice tools
  await page.getByRole("button", { name: "Practice tools", exact: true }).click();

  // The tablist should be visible
  await expect(page.getByRole("tablist", { name: "Choose a practice tool" })).toBeVisible();

  // Click the Quiz tab and verify the quiz panel becomes visible
  await page.getByRole("tab", { name: "Quiz" }).click();
  await expect(page.getByRole("tabpanel", { name: /quiz/i })).toBeVisible();
});

test("vocabulary (Words) tab is accessible from Practice tools", async ({ context, page }) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(
    page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
  ).toBeVisible();

  // Open Practice tools
  await page.getByRole("button", { name: "Practice tools", exact: true }).click();

  // Click the Words tab
  await page.getByRole("tab", { name: "Words" }).click();
  await expect(page.getByRole("tabpanel", { name: /words/i })).toBeVisible();
});

test("navigating to /study shows the Study list page for an authenticated reader", async ({
  context,
  page,
}) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto("/study");
  await expect(page.getByRole("heading", { name: "Study list" })).toBeVisible();
});
