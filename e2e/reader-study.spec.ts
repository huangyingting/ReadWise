/**
 * E2E: reader practice-tools flow — quiz panel + vocabulary save/review.
 *
 * Seeds the smoke article and opens it as a Reader.  Exercises the "Practice
 * tools" toolbar button, verifying that the quiz and words tabs open correctly.
 * Because the CI environment has no AI configured, the quiz shows a graceful
 * empty/loading state and the vocabulary panel shows the words tab; the test
 * does not depend on AI-generated content.
 */
import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";
import type { Page } from "@playwright/test";

async function openPracticeTools(page: Page) {
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(
    page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Practice tools", exact: true }).click();
}

test("opens the Practice tools panel and shows the quiz tab", async ({ readerPage: page }) => {
  await openPracticeTools(page);

  // The tablist should be visible
  await expect(page.getByRole("tablist", { name: "Choose a practice tool" })).toBeVisible();

  // Arrow navigation moves focus and activates the next tool tab.
  await page.getByRole("tab", { name: "Words" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Quiz" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Quiz" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tabpanel", { name: /quiz/i })).toBeVisible();
});

test("vocabulary (Words) tab is accessible from Practice tools", async ({ readerPage: page }) => {
  await openPracticeTools(page);

  // Click the Words tab
  await page.getByRole("tab", { name: "Words" }).click();
  await expect(page.getByRole("tabpanel", { name: /words/i })).toBeVisible();
});

test("navigating to /study shows the Study list page for an authenticated reader", async ({
  readerPage: page,
}) => {
  await page.goto("/study");
  await expect(page.getByRole("heading", { name: "Study list" })).toBeVisible();
});
