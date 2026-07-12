import { randomUUID } from "node:crypto";

import { type Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";

async function createAdminSeries(page: Page, unique: string) {
  const response = await page.request.post("/api/admin/series", {
    data: {
      slug: `e2e-admin-series-${unique}`,
      title: `E2E Admin Series ${unique}`,
      description: "Browser coverage for the admin series row actions.",
      public: false,
      status: "draft",
    },
  });

  expect(response.status()).toBe(201);
  const body = (await response.json()) as { series: { id: string } };
  return {
    id: body.series.id,
    title: `E2E Admin Series ${unique}`,
  };
}

test("@high-risk admin series row actions keep failures open and only close on success", async ({
  adminPage: page,
}) => {
  test.setTimeout(240_000);

  const unique = randomUUID().slice(0, 8);
  const series = await createAdminSeries(page, unique);

  await page.goto("/admin/series");
  const row = page.locator("tr").filter({ hasText: series.title }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("draft");

  const activateDialog = page.getByRole("alertdialog", { name: "Confirm activate" });
  const archiveDialog = page.getByRole("alertdialog", { name: "Confirm archive" });
  const deleteDialog = page.getByRole("alertdialog", { name: "Confirm delete" });

  // Activate failure: panel stays open, error is visible, and the row remains draft.
  await page.route(`**/api/admin/series/${series.id}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary activate outage" }),
    });
  }, { times: 1 });
  await row.getByRole("button", { name: "Activate" }).click();
  await expect(activateDialog).toBeVisible();
  await activateDialog.getByRole("button", { name: "Confirm activate" }).click();
  await expect(activateDialog).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Temporary activate outage" }).first()).toBeVisible();
  await expect(activateDialog.getByRole("button", { name: "Confirm activate" })).toBeEnabled();
  await expect(row).toContainText("draft");
  await activateDialog.getByRole("button", { name: "Cancel" }).click();

  // Activate success: closes the dialog and refreshes the row to active.
  await row.getByRole("button", { name: "Activate" }).click();
  await activateDialog.getByRole("button", { name: "Confirm activate" }).click();
  await expect(activateDialog).toHaveCount(0);
  await expect(row).toContainText("active", { timeout: 60_000 });

  // Archive failure: panel stays open, error is visible, and the row remains active.
  await page.route(`**/api/admin/series/${series.id}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary archive outage" }),
    });
  }, { times: 1 });
  await row.getByRole("button", { name: "Archive" }).click();
  await expect(archiveDialog).toBeVisible();
  await archiveDialog.getByRole("button", { name: "Confirm archive" }).click();
  await expect(archiveDialog).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Temporary archive outage" }).first()).toBeVisible();
  await expect(archiveDialog.getByRole("button", { name: "Confirm archive" })).toBeEnabled();
  await expect(row).toContainText("active");
  await archiveDialog.getByRole("button", { name: "Cancel" }).click();

  // Archive success: closes the dialog and refreshes the row to archived.
  await row.getByRole("button", { name: "Archive" }).click();
  await archiveDialog.getByRole("button", { name: "Confirm archive" }).click();
  await expect(archiveDialog).toHaveCount(0);
  await expect(row).toContainText("archived", { timeout: 60_000 });

  // Delete failure: panel stays open, error is visible, and the row remains.
  await page.route(`**/api/admin/series/${series.id}`, async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary delete outage" }),
    });
  }, { times: 1 });
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Confirm delete" }).click();
  await expect(deleteDialog).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Temporary delete outage" }).first()).toBeVisible();
  await expect(deleteDialog.getByRole("button", { name: "Confirm delete" })).toBeEnabled();
  await expect(row).toContainText("archived");
  await deleteDialog.getByRole("button", { name: "Cancel" }).click();

  // Delete success: closes the dialog and removes the row after refresh.
  await row.getByRole("button", { name: "Delete" }).click();
  await deleteDialog.getByRole("button", { name: "Confirm delete" }).click();
  await expect(deleteDialog).toHaveCount(0);
  await expect(row).toHaveCount(0, { timeout: 60_000 });
});
