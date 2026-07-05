/**
 * E2E: persisted state-changing flows for high-risk UI paths.
 *
 * These tests intentionally verify state after reload or navigation, not just
 * optimistic UI updates. Seed data is deterministic and provider-free.
 */
import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";
import type { Page } from "@playwright/test";
import {
  addSessionCookie,
  createSessionForUser,
  seedTeacherClassroom,
} from "./support/seed";

test.setTimeout(300_000);

async function gotoSeededArticle(page: Page) {
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(
    page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
  ).toBeVisible();
}

async function prewarmJsonRoute(page: Page, method: "get" | "post", url: string, data?: unknown) {
  if (method === "get") {
    await page.request.get(url, { timeout: 120_000 });
    return;
  }
  await page.request.post(url, { data, timeout: 120_000 });
}

test("bookmark and named-list membership persist after reload", async ({
  readerPage: page,
}) => {
  await gotoSeededArticle(page);
  await prewarmJsonRoute(page, "post", "/api/lists", { name: "" });
  await prewarmJsonRoute(
    page,
    "get",
    `/api/bookmarks/membership?articleId=${encodeURIComponent(TEST_ARTICLE_ID)}`,
  );

  const saveButton = page.getByRole("button", { name: "Save to reading list" });
  await saveButton.click();
  await expect(saveButton).toHaveAttribute("aria-pressed", "true");

  const created = await page.request.post("/api/lists", {
    data: { name: "E2E Saved Set" },
    timeout: 120_000,
  });
  const { list } = (await created.json()) as { list: { id: string } };
  await prewarmJsonRoute(page, "post", `/api/lists/${list.id}/items`, {
    articleId: "missing-article",
  });

  await page.getByRole("button", { name: "Add to list" }).click();
  const namedList = page.getByRole("checkbox", { name: "E2E Saved Set" });
  await expect(namedList).not.toBeChecked({ timeout: 60_000 });
  await namedList.check();
  await expect(namedList).toBeChecked({ timeout: 60_000 });

  await page.reload();
  await expect(page.getByRole("button", { name: "Save to reading list" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByRole("checkbox", { name: "E2E Saved Set" })).toBeChecked();
});

test("admin moderation verdict persists after reload", async ({ adminPage: page }) => {
  await page.goto(`/admin/articles/${TEST_ARTICLE_ID}`);
  await expect(page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" })).toBeVisible();
  await prewarmJsonRoute(page, "post", `/api/admin/articles/${TEST_ARTICLE_ID}/review`, {});

  await page.getByLabel("Review verdict").selectOption("approved");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 60_000 });

  await page.reload();
  await expect(page.getByText("Approved").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review history" })).toBeVisible();
});

test("teacher assignment created from the classroom UI persists after reload", async ({
  context,
  page,
}) => {
  const { teacher, classroom } = await seedTeacherClassroom();
  const session = await createSessionForUser(teacher.id);
  await addSessionCookie(context, session.sessionToken, session.expires);

  await page.goto(`/teacher/classrooms/${classroom.id}`);
  await expect(page.getByRole("heading", { name: "E2E Reading Group" })).toBeVisible();
  await expect(page.getByText("No assignments yet.")).toBeVisible();

  await page
    .getByRole("button", { name: /E2E Critical Reading Smoke Article/ })
    .click();
  await page.getByLabel("Instructions (optional)").fill("Read and summarize the article.");
  await page.getByRole("button", { name: "Assign article" }).click();
  const assignmentRow = page
    .locator("li")
    .filter({ hasText: "E2E Critical Reading Smoke Article" })
    .filter({ hasText: /0\/1 done/ })
    .first();
  await expect(assignmentRow).toBeVisible({ timeout: 60_000 });

  await page.reload();
  await expect(assignmentRow).toBeVisible();
});

test("offline-saved article remains available after navigation and reload", async ({
  readerPage: page,
}) => {
  await gotoSeededArticle(page);
  await prewarmJsonRoute(page, "get", `/api/reader/${TEST_ARTICLE_ID}/offline?meta=1`);

  await page.getByRole("button", { name: "Download for offline reading" }).click();
  await expect(
    page.getByRole("button", { name: "Article saved offline — click to remove" }),
  ).toBeVisible({ timeout: 60_000 });

  await page.goto("/offline");
  const savedArticle = page.getByRole("link", {
    name: "E2E Critical Reading Smoke Article",
    exact: true,
  });
  await expect(savedArticle).toBeVisible();

  await page.reload();
  await expect(savedArticle).toBeVisible();
});
