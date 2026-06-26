/**
 * E2E: teacher workspace and student assignments smoke.
 *
 * Exercises the /teacher page (teaching workspace) and the /assignments page
 * (student reading assignments). Both pages are accessible to any authenticated
 * reader and render meaningful empty states when no organisation or classroom
 * data exists — making them safe to test against the minimal seed data.
 *
 * No external providers (OAuth, AI, Speech) are required.
 */
import { expect, test } from "@playwright/test";
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

test("teacher workspace loads and shows Teaching heading", async ({ context, page }) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto("/teacher");
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole("heading", { name: "Teaching" })).toBeVisible();
});

test("teacher workspace shows empty classroom state for a new reader", async ({
  context,
  page,
}) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto("/teacher");
  await expect(page.getByRole("heading", { name: "Teaching" })).toBeVisible();
  // A user with no classrooms sees the empty state
  await expect(page.getByText("No classrooms yet")).toBeVisible();
});

test("student assignments page loads and shows Assignments heading", async ({
  context,
  page,
}) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto("/assignments");
  await expect(page).toHaveURL(/\/assignments$/);
  await expect(page.getByRole("heading", { name: "Assignments" })).toBeVisible();
});

test("student assignments page shows empty state when no assignments exist", async ({
  context,
  page,
}) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto("/assignments");
  await expect(page.getByRole("heading", { name: "Assignments" })).toBeVisible();
  await expect(page.getByText("No assignments yet")).toBeVisible();
});

test("unauthenticated user is redirected from /teacher", async ({ page }) => {
  await page.goto("/teacher");
  await expect(page).toHaveURL(/\/signin/);
});

test("unauthenticated user is redirected from /assignments", async ({ page }) => {
  await page.goto("/assignments");
  await expect(page).toHaveURL(/\/signin/);
});
