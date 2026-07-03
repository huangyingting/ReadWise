/**
 * E2E: admin article management and job queue smoke.
 *
 * Seeds the smoke article and signs in as an Admin. Exercises
 * /admin/articles (article listing + search bar) and /admin/jobs (job queue
 * dashboard) without triggering any real scraper or AI calls.
 *
 * The test verifies that the pages render with correct headings and core
 * controls so that a regression in admin middleware or layout is caught early.
 */
import { expect, test, type BrowserContext } from "@playwright/test";
import {
  addSessionCookie,
  createUserWithSession,
  disconnectDb,
  seedSmokeData,
} from "./support/seed";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  await seedSmokeData();
});

test.afterAll(async () => {
  await disconnectDb();
});

async function signInAs(context: BrowserContext, role: "Admin" | "Reader") {
  const { sessionToken, expires } = await createUserWithSession({ role });
  await addSessionCookie(context, sessionToken, expires);
}

test("admin can view the Articles management page", async ({ context, page }) => {
  await signInAs(context, "Admin");

  await page.goto("/admin/articles");
  await expect(page).toHaveURL(/\/admin\/articles$/);
  await expect(page.getByRole("heading", { name: "Articles" })).toBeVisible();

  // Search bar is present
  await expect(
    page.getByPlaceholder("Search title, author or source…"),
  ).toBeVisible();

  // Seeded article is listed
  await expect(
    page.getByRole("link", { name: /E2E Critical Reading/ }),
  ).toBeVisible();
});

test("admin can filter articles by status", async ({ context, page }) => {
  await signInAs(context, "Admin");

  await page.goto("/admin/articles");
  await expect(page.getByRole("heading", { name: "Articles" })).toBeVisible();

  // The status filter select exists
  const statusFilter = page.getByRole("combobox");
  await expect(statusFilter).toBeVisible();
});

test("admin can view the Jobs queue page", async ({ context, page }) => {
  await signInAs(context, "Admin");

  await page.goto("/admin/jobs");
  await expect(page).toHaveURL(/\/admin\/jobs$/);
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
});

test("admin can view the Members page", async ({ context, page }) => {
  await signInAs(context, "Admin");

  await page.goto("/admin/members");
  await expect(page).toHaveURL(/\/admin\/members$/);
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
});

test("non-admin reader is redirected away from /admin", async ({ context, page }) => {
  await signInAs(context, "Reader");

  await page.goto("/admin");
  // Readers should not reach the admin dashboard
  await expect(page).not.toHaveURL(/\/admin$/);
});
