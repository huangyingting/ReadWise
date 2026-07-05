import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";
import type { Page } from "@playwright/test";

async function expectSeededReader(page: Page) {
  await expect(page).toHaveURL(new RegExp(`/reader/${TEST_ARTICLE_ID}$`));
  await expect(
    page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
  ).toBeVisible();
}

test("shows onboarding for an authenticated reader without a profile", async ({
  signIn,
  page,
}) => {
  await signIn({
    onboarded: false,
  });

  await page.goto("/onboarding");
  await expect(
    page.getByRole("heading", { name: "Welcome to ReadWise" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your English level" })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("opens dashboard, browse, reader, and admin with a seeded admin session", async ({
  adminPage: page,
}) => {
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
  await expectSeededReader(page);
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
    signIn,
    mobilePage: page,
  }) => {
    await signIn();

    await page.goto(`/reader/${TEST_ARTICLE_ID}`);
    await expectSeededReader(page);

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
