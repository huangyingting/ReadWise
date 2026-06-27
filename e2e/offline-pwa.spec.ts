/**
 * E2E: offline library, reading progress, and notes/highlights pages.
 *
 * - /offline — PWA offline library (IndexedDB-backed, client-side only).
 *   The page renders the "Offline Library" heading and a descriptive subtitle
 *   even when IndexedDB is empty or unavailable.
 *
 * - /progress — Reading progress dashboard. Shows "My Progress" heading and,
 *   for a new onboarded user with no activity, the reading-activity empty state.
 *
 * - /notes — Highlights & notes index. Shows "Notes & Highlights" heading and,
 *   for a user with no highlights, the "No highlights yet" empty state.
 *
 * No external providers or AI services are required. All pages are accessible
 * to any onboarded authenticated reader.
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

// ---------------------------------------------------------------------------
// Offline library
// ---------------------------------------------------------------------------

test("offline library loads and shows Offline Library heading", async ({
  context,
  page,
}) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto("/offline");
  await expect(page).toHaveURL(/\/offline$/);
  await expect(page.getByRole("heading", { name: "Offline Library" })).toBeVisible();
});

test("offline library shows instructional subtitle", async ({ context, page }) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto("/offline");
  await expect(
    page.getByText(/Articles saved here are available when you.re offline/),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// Reading progress
// ---------------------------------------------------------------------------

test("progress page loads and shows My Progress heading", async ({
  context,
  page,
}) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto("/progress");
  await expect(page).toHaveURL(/\/progress$/);
  await expect(page.getByRole("heading", { name: "My Progress" })).toBeVisible();
});

test("progress page shows empty activity state for a new reader", async ({ context, page }) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto("/progress");
  await expect(
    page.getByText(/No reading activity in the past 52 weeks/),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// Notes & highlights
// ---------------------------------------------------------------------------

test("notes page loads and shows Notes & Highlights heading", async ({
  context,
  page,
}) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto("/notes");
  await expect(page).toHaveURL(/\/notes$/);
  await expect(
    page.getByRole("heading", { name: "Notes & Highlights" }),
  ).toBeVisible();
});

test("notes page shows empty state when user has no highlights", async ({
  context,
  page,
}) => {
  const { sessionToken, expires } = await createUserWithSession();
  await addSessionCookie(context, sessionToken, expires);

  await page.goto("/notes");
  await expect(page.getByText("No highlights yet")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Unauthenticated guards
// ---------------------------------------------------------------------------

test("unauthenticated user is redirected from /offline", async ({ page }) => {
  await page.goto("/offline");
  await expect(page).toHaveURL(/\/signin/);
});

test("unauthenticated user is redirected from /notes", async ({ page }) => {
  await page.goto("/notes");
  await expect(page).toHaveURL(/\/signin/);
});
