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
import { test, expect } from "./support/fixtures";

test("admin can view the Articles management page", async ({ adminPage: page }) => {
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

test("admin can filter articles by status", async ({ adminPage: page }) => {
  await page.goto("/admin/articles");
  await expect(page.getByRole("heading", { name: "Articles" })).toBeVisible();

  // The status filter select exists
  const statusFilter = page.getByRole("combobox");
  await expect(statusFilter).toBeVisible();
});

test("admin can view the Jobs queue page", async ({ adminPage: page }) => {
  await page.goto("/admin/jobs");
  await expect(page).toHaveURL(/\/admin\/jobs$/);
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
});

test("admin can view the Members page", async ({ adminPage: page }) => {
  await page.goto("/admin/members");
  await expect(page).toHaveURL(/\/admin\/members$/);
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
});

test("admin article sort headers expose aria-sort and keyboard links", async ({
  adminPage: page,
}) => {
  await page.goto("/admin/articles?sort=title&order=asc");

  const titleHeader = page.locator("th[aria-sort='ascending']").filter({
    has: page.getByRole("link", { name: /Title: sorted ascending/i }),
  });
  await expect(titleHeader).toBeVisible();

  const titleSort = page.getByRole("link", {
    name: /Title: sorted ascending\. Activate to sort descending/i,
  });
  await titleSort.focus();
  await expect(titleSort).toBeFocused();
  await expect(titleSort).toHaveAttribute("href", /order=desc/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/sort=title/);
  await expect(page).toHaveURL(/order=desc/);
});

test("non-admin reader is redirected away from /admin", async ({ readerPage: page }) => {
  await page.goto("/admin");
  // Readers should not reach the admin dashboard
  await expect(page).not.toHaveURL(/\/admin$/);
});
