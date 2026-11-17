/**
 * E2E: multi-level article variants (#1303).
 *
 * An admin adds a B1 level; readers switch between B1 and Original with the
 * Reading level pills (highlights stay on their level); a teacher locks an
 * assignment to B1 and the student reads B1 without a switcher.
 */
import type { BrowserContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { expect, TEST_ARTICLE_ID, test } from "./support/fixtures";
import { addSessionCookie, createSessionForUser, createUserWithSession, seedTeacherClassroom } from "./support/seed";

const FIRST_COMPILE_TIMEOUT = 60_000;
const PREWARM_TIMEOUT = 120_000;
const B1_TITLE = "Learners Read Real News";
const B1_TEXT = "ReadWise helps people learn English with real news stories.\n\nThe app shows short articles at many levels.";

test.beforeAll(async ({ playwright }, testInfo) => {
  testInfo.setTimeout(PREWARM_TIMEOUT * 2);
  const session = await createUserWithSession({ role: "Admin" });
  const api = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
    extraHTTPHeaders: { cookie: `next-auth.session-token=${session.sessionToken}` },
  });
  for (const path of [
    `/admin/articles/${TEST_ARTICLE_ID}`,
    `/reader/${TEST_ARTICLE_ID}?level=B1`,
    `/api/reader/${TEST_ARTICLE_ID}/levels`,
    `/api/reader/${TEST_ARTICLE_ID}/highlights?level=B1`,
  ]) {
    await api.get(path, { timeout: PREWARM_TIMEOUT });
  }
  await api.dispose();
});

async function signInAs(context: BrowserContext, userId: string) {
  for (const open of context.pages()) await open.goto("about:blank");
  await context.clearCookies();
  const session = await createSessionForUser(userId);
  await addSessionCookie(context, session.sessionToken, session.expires);
}

test("admins add a level and readers switch levels with level-scoped highlights", async ({ context, page }) => {
  const admin = await createUserWithSession({ role: "Admin" });
  await addSessionCookie(context, admin.sessionToken, admin.expires);

  await page.goto(`/admin/articles/${TEST_ARTICLE_ID}`);
  const levels = page.getByRole("list", { name: "Reading levels" });
  await levels.getByRole("button", { name: "Add level B1" }).click({ timeout: FIRST_COMPILE_TIMEOUT });
  await levels.getByLabel("B1 headline").fill(B1_TITLE);
  await levels.getByLabel("B1 text").fill(B1_TEXT);
  await levels.getByRole("button", { name: "Save level" }).click();
  await expect(levels.getByText("Manual")).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(levels.getByText(/17 words/)).toBeVisible();

  // Reader: original first, then switch to B1.
  const reader = await createUserWithSession({ role: "Reader" });
  await signInAs(context, reader.userId);
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  const switcher = page.getByRole("navigation", { name: "Reading level" });
  await expect(switcher.getByRole("link", { name: "Original" })).toHaveAttribute("aria-current", "page", {
    timeout: FIRST_COMPILE_TIMEOUT,
  });
  await switcher.getByRole("link", { name: /^B1 ·/ }).click();
  await expect(page).toHaveURL(/\?level=B1$/);
  await expect(page.getByRole("heading", { name: B1_TITLE, level: 1 })).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.locator(".word-lookup-prose").first()).toContainText("The app shows short articles");
  await expect(page.getByRole("button", { name: /listen/i })).toHaveCount(0);

  // A highlight on B1 stays on B1.
  const prose = page.locator(".word-lookup-prose").first();
  const text = (await prose.textContent()) ?? "";
  const start = text.indexOf("short articles");
  const created = await page.request.post(`/api/reader/${TEST_ARTICLE_ID}/highlights?level=B1`, {
    data: { quote: "short articles", startOffset: start, endOffset: start + 14 },
  });
  expect(created.status()).toBe(201);
  await page.reload();
  await expect(page.locator("mark.rw-hl")).toHaveText("short articles", { timeout: FIRST_COMPILE_TIMEOUT });
  await switcher.getByRole("link", { name: "Original" }).click();
  await expect(page.getByRole("heading", { name: "E2E Critical Reading Smoke Article", level: 1 })).toBeVisible({
    timeout: FIRST_COMPILE_TIMEOUT,
  });
  await expect(page.locator("mark.rw-hl")).toHaveCount(0);
});

test("teachers lock an assignment to a level for their students", async ({ context, page }) => {
  const { teacher, student, classroom } = await seedTeacherClassroom();
  await prisma.articleLevel.create({
    data: { articleId: TEST_ARTICLE_ID, levelKey: "B1", title: B1_TITLE, content: "<p>Short simple news.</p>", wordCount: 3 },
  });
  const assignment = await prisma.assignment.create({ data: { classroomId: classroom.id, articleId: TEST_ARTICLE_ID } });

  // Teacher: lock the level from the classroom page.
  await signInAs(context, teacher.id);
  await page.goto(`/teacher/classrooms/${classroom.id}`);
  await page.getByRole("button", { name: /^Edit assignment/ }).click({ timeout: FIRST_COMPILE_TIMEOUT });
  await page.getByRole("combobox", { name: "Reading level" }).click();
  await page.getByRole("option", { name: /^B1 ·/ }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/^Level B1 ·/)).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } })).lockedLevelKey).toBe("B1");

  // Student: reads B1 regardless of the requested level.
  await signInAs(context, student.id);
  await page.goto(`/reader/${TEST_ARTICLE_ID}?level=original`);
  await expect(page.getByRole("heading", { name: B1_TITLE, level: 1 })).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.getByText(/set by your teacher/)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Reading level" })).toHaveCount(0);
});
