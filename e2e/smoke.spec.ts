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

test("shows onboarding for an authenticated reader without a profile", async ({
  context,
  page,
}) => {
  const { sessionToken, expires } = await createUserWithSession({
    onboarded: false,
  });
  await addSessionCookie(context, sessionToken, expires);

  await page.goto("/onboarding");
  await expect(
    page.getByRole("heading", { name: "Welcome to ReadWise" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your English level" })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("opens dashboard, browse, reader, and admin with a seeded admin session", async ({
  context,
  page,
}) => {
  const { sessionToken, expires } = await createUserWithSession({
    role: "Admin",
  });
  await addSessionCookie(context, sessionToken, expires);

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "For You" })).toBeVisible();
  await expect(page.getByRole("link", { name: /E2E Critical Reading/ })).toBeVisible();

  await page.goto("/browse");
  await expect(page.getByRole("heading", { name: "Browse" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "All categories" })).toBeVisible();
  const articleLink = page.getByRole("link", { name: /E2E Critical Reading/ }).first();
  await expect(articleLink).toHaveAttribute("href", `/reader/${TEST_ARTICLE_ID}`);

  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(page).toHaveURL(new RegExp(`/reader/${TEST_ARTICLE_ID}$`));
  await expect(
    page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
  ).toBeVisible();
  await expect(page.getByLabel("Display settings")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Practice tools", exact: true }),
  ).toBeVisible();

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Overview")).toBeVisible();
  await expect(page.getByText(/Signed in as/)).toBeVisible();
});

test.describe("mobile-ish reader", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });

  test("keeps core reading controls usable on a narrow viewport", async ({
    context,
    page,
  }) => {
    const { sessionToken, expires } = await createUserWithSession();
    await addSessionCookie(context, sessionToken, expires);

    await page.goto(`/reader/${TEST_ARTICLE_ID}`);
    await expect(
      page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
    ).toBeVisible();

    await page.getByLabel("Display settings").click();
    await expect(
      page.getByRole("dialog", { name: "Display settings" }),
    ).toBeVisible();
    await expect(page.getByLabel("Increase text size")).toBeVisible();

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  });
});
