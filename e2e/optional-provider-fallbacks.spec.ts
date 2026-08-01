/**
 * Browser/API contracts for a deployment with no optional external providers.
 *
 * `playwright.config.ts` explicitly clears OAuth, AI, Speech, Push, and Azure
 * storage credentials for these tests. The application must remain usable and
 * surface controlled fallback states without attempting live provider calls.
 */
import { expect, test, TEST_ARTICLE_ID } from "./support/fixtures";

test("sign-in explains when no OAuth providers are configured", async ({ page }) => {
  await page.goto("/signin");

  await expect(page.getByRole("heading", { name: "Sign in to ReadWise" })).toBeVisible();
  await expect(
    page.getByText("No authentication providers are configured."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with/i })).toHaveCount(0);
});

test("settings omit push controls when VAPID is unconfigured", async ({
  page,
  signIn,
}) => {
  await signIn();
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notifications" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: /review reminders/i })).toHaveCount(0);
});

test("narration API returns a controlled fallback when Speech is unconfigured", async ({
  page,
  signIn,
}) => {
  await signIn();

  const response = await page.request.post(`/api/reader/${TEST_ARTICLE_ID}/speech`);
  expect(response.status()).toBe(200);
  await expect(response).toBeOK();

  const body = await response.json() as {
    audioUrl?: string | null;
    fallback?: boolean;
    fallbackReason?: string;
  };
  expect(body.fallback).toBe(true);
  expect(body.fallbackReason).toBe("tts_unconfigured");
  expect(body.audioUrl).toBeNull();
});

test("tutor API returns a controlled fallback when AI is unconfigured", async ({
  page,
  signIn,
}) => {
  await signIn();

  const response = await page.request.post(`/api/reader/${TEST_ARTICLE_ID}/tutor`, {
    data: { question: "What is the main idea?" },
  });
  expect(response.status()).toBe(200);
  await expect(response).toBeOK();

  const body = await response.json() as {
    answer?: string;
    fallback?: boolean;
    messages?: unknown[];
  };
  expect(body.fallback).toBe(true);
  expect(body.answer).toMatch(/unavailable/i);
  expect(body.messages).toEqual([]);
});
