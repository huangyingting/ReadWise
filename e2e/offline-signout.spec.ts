import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";
import type { Page } from "@playwright/test";

type OfflineState = {
  actorId: string | null;
  accessBlocked: string | null;
  articleCount: number;
  mutationCount: number;
};

async function readOfflineState(page: Page): Promise<OfflineState> {
  return page.evaluate(async () => {
    const counts = await new Promise<{
      articleCount: number;
      mutationCount: number;
    }>((resolve, reject) => {
      const request = indexedDB.open("readwise-offline", 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(
          ["articles", "mutations"],
          "readonly",
        );
        const articleRequest = transaction.objectStore("articles").count();
        const mutationRequest = transaction.objectStore("mutations").count();
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => {
          resolve({
            articleCount: articleRequest.result,
            mutationCount: mutationRequest.result,
          });
          db.close();
        };
      };
    });

    return {
      actorId: localStorage.getItem("readwise:offline-actor-id"),
      accessBlocked: localStorage.getItem("readwise:offline-access-blocked"),
      ...counts,
    };
  });
}

async function saveSeededArticleOffline(page: Page): Promise<void> {
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(
    page.getByRole("heading", {
      name: "E2E Critical Reading Smoke Article",
    }),
  ).toBeVisible();
  await page.request.get(`/api/reader/${TEST_ARTICLE_ID}/offline?meta=1`, {
    timeout: 120_000,
  });
  await page.getByRole("button", {
    name: "Download for offline reading",
  }).click();
  await expect(
    page.getByRole("button", {
      name: "Article saved offline — click to remove",
    }),
  ).toBeVisible({ timeout: 60_000 });
}

test("sign-out purges offline data and leaves the public app usable", async ({
  readerPage: page,
  readerSession,
}) => {
  await saveSeededArticleOffline(page);
  await expect
    .poll(() => readOfflineState(page))
    .toMatchObject({
      actorId: readerSession.userId,
      accessBlocked: null,
      articleCount: 1,
    });

  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", { name: "Get Started — It's Free" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "This session changed in another tab",
    }),
  ).toHaveCount(0);
  await expect
    .poll(() => readOfflineState(page))
    .toMatchObject({
      actorId: null,
      accessBlocked: "1",
      articleCount: 0,
      mutationCount: 0,
    });
});

test("sign-out hides an already-rendered private page in another tab", async ({
  context,
  readerPage: page,
}) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const stalePage = await context.newPage();
  await stalePage.goto("/dashboard");
  await expect(
    stalePage.getByRole("heading", { name: "Dashboard" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(
    stalePage.getByRole("heading", {
      name: "This session changed in another tab",
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", { name: "Get Started — It's Free" }).first(),
  ).toBeVisible();
  await expect(stalePage).toHaveURL(/\/signin/, { timeout: 30_000 });
  await expect(
    stalePage.getByRole("heading", { name: "Sign in to ReadWise" }),
  ).toBeVisible();
});

test("account deletion purges offline data and invalidates the session", async ({
  readerPage: page,
}) => {
  await saveSeededArticleOffline(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.getByRole("button", { name: "Delete my account" }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Confirm delete my account",
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByLabel("Type DELETE to confirm:").fill("DELETE");
  await confirmation.getByRole("button", {
    name: "Yes, delete my account",
  }).click();

  await expect(page).toHaveURL(/\/signin$/);
  await expect(
    page.getByRole("heading", { name: "Sign in to ReadWise" }),
  ).toBeVisible();
  await expect
    .poll(() => readOfflineState(page))
    .toMatchObject({
      actorId: null,
      accessBlocked: "1",
      articleCount: 0,
      mutationCount: 0,
    });

  const deletedSession = await page.request.get("/api/auth/session");
  expect(deletedSession.status()).toBe(200);
  expect(await deletedSession.json()).toEqual({});
});
