/**
 * E2E: educator reader tools and student activities (#1304).
 *
 * A teacher opens "Apply to your lesson" (scaffolds, oral fluency, poll and
 * checks), previews the student view, and prints the fluency sheet; a student
 * votes in the pre-reading poll and answers a Check for Understanding;
 * readers who aren't educators never see the tools.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { expect, TEST_ARTICLE_ID, test } from "./support/fixtures";
import { addSessionCookie, createSessionForUser, createUserWithSession, seedTeacherClassroom } from "./support/seed";

const FIRST_COMPILE_TIMEOUT = 60_000;
const PREWARM_TIMEOUT = 120_000;

test.beforeAll(async ({ playwright }, testInfo) => {
  testInfo.setTimeout(PREWARM_TIMEOUT * 2);
  const session = await createUserWithSession({ role: "Admin" });
  const api = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
    extraHTTPHeaders: { cookie: `next-auth.session-token=${session.sessionToken}` },
  });
  for (const path of [
    `/reader/${TEST_ARTICLE_ID}`,
    `/reader/${TEST_ARTICLE_ID}?view=student`,
    `/api/reader/${TEST_ARTICLE_ID}/activities`,
    `/reader/${TEST_ARTICLE_ID}/print?mode=fluency&words=100`,
  ]) {
    await api.get(path, { timeout: PREWARM_TIMEOUT });
  }
  await api.post(`/api/reader/${TEST_ARTICLE_ID}/lesson`, { timeout: PREWARM_TIMEOUT, data: {} });
  await api.dispose();
});

async function signInAs(context: BrowserContext, userId: string) {
  for (const open of context.pages()) await open.goto("about:blank");
  await context.clearCookies();
  const session = await createSessionForUser(userId);
  await addSessionCookie(context, session.sessionToken, session.expires);
}

async function openLessonSheet(page: Page) {
  await page.getByRole("button", { name: "Apply to your lesson" }).click({ timeout: FIRST_COMPILE_TIMEOUT });
  return page.getByRole("dialog", { name: "Apply to your lesson" });
}

test("teachers plan with lesson tools; students vote and check understanding", async ({ context, page }) => {
  const { teacher, student, classroom } = await seedTeacherClassroom();
  await prisma.assignment.create({ data: { classroomId: classroom.id, articleId: TEST_ARTICLE_ID } });

  // Teacher: scaffolds, fluency passage, then poll + check.
  await signInAs(context, teacher.id);
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(page.getByLabel("Educator tools")).toBeVisible({
    timeout: FIRST_COMPILE_TIMEOUT,
  });
  let sheet = await openLessonSheet(page);
  await expect(sheet.getByRole("heading", { name: "Discussion questions" })).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(sheet.getByRole("heading", { name: "Before-reading hook" })).toBeVisible();

  await sheet.getByRole("button", { name: "Oral fluency" }).click();
  await expect(sheet.getByRole("table", { name: "100-word fluency passage" })).toBeVisible();
  await sheet.getByRole("button", { name: "150 words" }).click();
  await expect(sheet.getByRole("table", { name: "150-word fluency passage" })).toBeVisible();
  await expect(sheet.getByRole("link", { name: /Print passage/ })).toHaveAttribute("href", /mode=fluency&words=150/);

  await sheet.getByRole("button", { name: "Poll & checks" }).click();
  await sheet.getByLabel("Poll question").fill("Do you read the news every day?");
  await sheet.getByLabel("Poll options").fill("Yes\nNo\nSometimes");
  await sheet.getByRole("button", { name: "Save poll" }).click();
  await expect(sheet.getByRole("button", { name: "Remove poll" })).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await sheet.getByLabel("Check question").fill("What does ReadWise help learners read?");
  await sheet.getByLabel("Answer choices").fill("Real English news\nRecipes");
  await sheet.getByRole("button", { name: "Add check" }).click();
  await expect(sheet.getByRole("list", { name: "Checks for understanding" })).toContainText(
    "What does ReadWise help learners read?",
  );
  await sheet.getByRole("button", { name: "Close lesson tools" }).click();

  // Teacher: preview the student view (responses aren't saved).
  await page.getByRole("link", { name: "View as student" }).click();
  await expect(page.getByText(/previewing this article as a student/)).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.getByLabel("Educator tools")).toHaveCount(0);
  await expect(page.getByText("Do you read the news every day?")).toBeVisible();
  await expect(page.getByText("Preview — not saved").first()).toBeVisible();
  await page.getByRole("link", { name: "Exit preview" }).click();
  await expect(page.getByLabel("Educator tools")).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });

  // Teacher: printable fluency sheet.
  await page.goto(`/reader/${TEST_ARTICLE_ID}/print?mode=fluency&words=100`);
  await expect(page.getByRole("heading", { name: /Oral fluency passage/ })).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });

  // Student: vote, then answer the check at the end of the article.
  await signInAs(context, student.id);
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(page.getByLabel("Educator tools")).toHaveCount(0, { timeout: FIRST_COMPILE_TIMEOUT });
  const poll = page.getByRole("group", { name: "Do you read the news every day?" });
  await poll.getByRole("button", { name: "Yes" }).click({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.getByText("1 vote from your class. There are no right answers.")).toBeVisible();
  const checks = page.getByRole("region", { name: "Checks for understanding" });
  await checks.scrollIntoViewIfNeeded();
  await checks.getByRole("button", { name: "Real English news" }).click();
  await expect(page.getByText("Correct.").first()).toBeVisible();

  // Teacher: sees the results.
  await signInAs(context, teacher.id);
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  sheet = await openLessonSheet(page);
  await sheet.getByRole("button", { name: "Poll & checks" }).click();
  await expect(sheet.getByText(/1 vote: Yes 1/)).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(sheet.getByText(/1\/1 correct/)).toBeVisible();
});

test("readers who aren't educators don't get educator tools or the fluency sheet", async ({ context, page }) => {
  const reader = await createUserWithSession({ role: "Reader" });
  await addSessionCookie(context, reader.sessionToken, reader.expires);
  await page.goto(`/reader/${TEST_ARTICLE_ID}?view=student`);
  await expect(page.locator(".word-lookup-prose").first()).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.getByLabel("Educator tools")).toHaveCount(0);
  await expect(page.getByText(/previewing this article as a student/)).toHaveCount(0);
  const lesson = await page.request.post(`/api/reader/${TEST_ARTICLE_ID}/lesson`, { data: {} });
  expect(lesson.status()).toBe(403);
  await page.goto(`/reader/${TEST_ARTICLE_ID}/print?mode=fluency`);
  await expect(page).toHaveURL(/\/forbidden/, { timeout: FIRST_COMPILE_TIMEOUT });
});
