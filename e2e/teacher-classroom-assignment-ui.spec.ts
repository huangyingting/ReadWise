import type { BrowserContext } from "@playwright/test";
import { test, expect } from "./support/fixtures";
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