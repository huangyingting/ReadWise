import type { BrowserContext } from "@playwright/test";
import { expect, TEST_ARTICLE_ID, test } from "./support/fixtures";
import {
  addSessionCookie,
  createSessionForUser,
  seedTeacherClassroom,
} from "./support/seed";

async function signInSeededTeacher(context: BrowserContext) {
  const seeded = await seedTeacherClassroom();
  const session = await createSessionForUser(seeded.teacher.id);
  await addSessionCookie(context, session.sessionToken, session.expires);
  return seeded;
}

test("assignment composer is prominent and usable on mobile", async ({
  context,
  mobilePage: page,
}) => {
  const { classroom } = await signInSeededTeacher(context);
  await page.goto(`/teacher/classrooms/${classroom.id}`);

  const trigger = page.getByRole("button", { name: "Assign reading" });
  await expect(trigger).toBeVisible();
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(triggerBox!.y + triggerBox!.height).toBeLessThan(844);

  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Assign a reading" });
  await expect(dialog).toBeVisible();

  const geometry = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      pageOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(390);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(844);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);

  const closeButton = page.getByRole("button", {
    name: "Close assignment form",
  });
  const closeBox = await closeButton.boundingBox();
  expect(closeBox).not.toBeNull();
  expect(closeBox!.width).toBeGreaterThanOrEqual(44);
  expect(closeBox!.height).toBeGreaterThanOrEqual(44);

  const article = page.getByRole("button", {
    name: /E2E Critical Reading Smoke Article/,
  });
  await expect(article).toHaveAttribute("aria-pressed", "false");
  await expect(article.locator("svg")).toHaveCount(0);
  await article.click();
  await expect(article).toHaveAttribute("aria-pressed", "true");
  await expect(article.locator("svg")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("bulk assignment partial failures stay open and keep failed articles selected", async ({
  context,
  page,
}) => {
  const { classroom } = await signInSeededTeacher(context);
  await page.goto(`/teacher/classrooms/${classroom.id}`);
  await page.getByRole("button", { name: "Assign reading" }).click();

  const dialog = page.getByRole("dialog", { name: "Assign a reading" });
  const successfulArticle = dialog.getByRole("button", {
    name: /E2E Critical Reading Smoke Article/,
  });
  const failedArticle = dialog.getByRole("button", {
    name: /E2E World News Practice/,
  });
  await successfulArticle.click();
  await failedArticle.click();

  await page.route(
    `**/api/classrooms/${classroom.id}/assignments/bulk`,
    async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          created: [{ articleId: TEST_ARTICLE_ID }],
          failed: [
            { articleId: "e2e-browse-world", reason: "article_not_found" },
          ],
        }),
      });
    },
    { times: 1 },
  );

  await dialog.getByRole("button", { name: "Assign 2 articles" }).click();

  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Assigned 1, 1 could not be assigned."),
  ).toBeVisible();
  await expect(successfulArticle).toHaveAttribute("aria-pressed", "false");
  await expect(failedArticle).toHaveAttribute("aria-pressed", "true");
  await expect(
    dialog.getByRole("button", { name: "Assign article" }),
  ).toBeEnabled();
});

test("assignment submission errors do not mark article search invalid", async ({
  context,
  page,
}) => {
  const { classroom } = await signInSeededTeacher(context);
  await page.goto(`/teacher/classrooms/${classroom.id}`);
  await page.getByRole("button", { name: "Assign reading" }).click();

  const dialog = page.getByRole("dialog", { name: "Assign a reading" });
  const articleSearch = dialog.getByLabel("Find article");
  await dialog
    .getByRole("button", { name: /E2E Critical Reading Smoke Article/ })
    .click();

  await page.route(
    `**/api/classrooms/${classroom.id}/assignments`,
    async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Assignment already exists" }),
      });
    },
    { times: 1 },
  );

  await dialog.getByRole("button", { name: "Assign article" }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Assignment already exists",
  );
  await expect(articleSearch).not.toHaveAttribute("aria-invalid", "true");
  await expect(articleSearch).toHaveAttribute(
    "aria-describedby",
    "article-picker-help",
  );
});
