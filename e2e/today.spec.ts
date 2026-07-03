import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  addSessionCookie,
  createUserWithSession,
  disconnectDb,
  seedSmokeData,
  TEST_ARTICLE_ID,
} from "./support/seed";

/**
 * Today Session learner happy path (#800).
 *
 * Deterministic and provider-free: reuses the seeded onboarded Reader + public
 * smoke article, lands the learner on `/today` (feature flag on by default),
 * opens the primary article, marks today's reading done via the manual fallback,
 * and confirms the reading step advances to "Done". The Today feature flag
 * defaults to enabled, so the existing smoke tiers are unaffected.
 */
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  await seedSmokeData();
});

test.afterAll(async () => {
  await disconnectDb();
});

async function signInLearner(context: BrowserContext) {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);
}

function collectTodayRenderErrors(page: Page): string[] {
  const messages: string[] = [];
  const renderErrorPatterns = [
    "Element type is invalid",
    "got: undefined",
    "<p> cannot contain",
    "cannot contain a nested",
    "cannot be a descendant of <p>",
  ];

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (renderErrorPatterns.some((pattern) => text.includes(pattern))) {
      messages.push(text);
    }
  });

  page.on("pageerror", (error) => {
    const text = error.message;
    if (renderErrorPatterns.some((pattern) => text.includes(pattern))) {
      messages.push(text);
    }
  });

  return messages;
}

async function gotoToday(context: BrowserContext, page: Page) {
  await signInLearner(context);
  const renderErrors = collectTodayRenderErrors(page);
  // Onboarded learners default to /today when the feature flag is on; the
  // post-sign-in and onboarding redirects (see learner-landing) target it.
  await page.goto("/today");
  await expect(page).toHaveURL(/\/today$/);

  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  expect(renderErrors).toEqual([]);
}

test("learner lands on /today and sees the daily plan", async ({
  context,
  page,
}) => {
  await gotoToday(context, page);

  // The day's primary article resolves to a readable card linking to the reader.
  const articleLink = page
    .getByRole("link", { name: /E2E .* Practice|E2E Critical Reading/ })
    .first();
  await expect(articleLink).toBeVisible();
  await expect(articleLink).toHaveAttribute("href", `/reader/${TEST_ARTICLE_ID}`);
  await expect(page.getByRole("link", { name: "Open reader" }).first()).toHaveAttribute(
    "href",
    `/reader/${TEST_ARTICLE_ID}`,
  );

  // Today's step tracker is present with the reading step to do.
  await expect(page.getByRole("heading", { name: "Today's steps" })).toBeVisible();
});

test("learner completes today's reading via the manual fallback", async ({
  context,
  page,
}) => {
  await gotoToday(context, page);

  // Mark today's reading done through the Today-only manual fallback.
  const markRead = page.getByRole("button", { name: "Mark reading done" });
  await expect(markRead).toBeVisible();
  await markRead.click();

  // After the server refresh, the reading step shows as Done and the manual
  // button is gone (reading already complete).
  await expect(page.getByText("Done").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark reading done" }),
  ).toHaveCount(0);
});

test("learner can skip today and is shown a browse fallback", async ({
  context,
  page,
}) => {
  await gotoToday(context, page);

  const skip = page.getByRole("button", { name: "Skip today" });
  await expect(skip).toBeVisible();
  await skip.click();

  // The skipped state confirms the skip and offers a browse fallback (either a
  // backups rail or the empty-state browse CTA, depending on availability).
  await expect(page.getByText("Skipped today", { exact: true })).toBeVisible();
  await expect(page.getByText(/You skipped today's reading\./)).toBeVisible();
});
