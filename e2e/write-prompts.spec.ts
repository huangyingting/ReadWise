/**
 * E2E: Write Prompt responses (#1305).
 *
 * A student drafts (autosave) and submits a response for their class; the
 * teacher returns it with rubric scores and feedback; the student revises and
 * resubmits; the teacher grades it. Independent writing never reaches the
 * teacher's responses page.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { expect, TEST_ARTICLE_ID, test } from "./support/fixtures";
import {
  addSessionCookie,
  createSessionForUser,
  createUserWithSession,
  seedTeacherClassroom,
} from "./support/seed";

const FIRST_COMPILE_TIMEOUT = 60_000;
const PREWARM_TIMEOUT = 120_000;

test.beforeAll(async ({ playwright }, testInfo) => {
  testInfo.setTimeout(PREWARM_TIMEOUT * 2);
  const session = await createUserWithSession({ role: "Reader" });
  const api = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
    extraHTTPHeaders: { cookie: `next-auth.session-token=${session.sessionToken}` },
  });
  for (const path of [
    `/reader/${TEST_ARTICLE_ID}`,
    `/api/reader/${TEST_ARTICLE_ID}/write`,
    "/teacher/classrooms/prewarm/assignments/prewarm/responses",
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

async function openWrite(page: Page) {
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await page.getByRole("button", { name: "Practice tools", exact: true }).click({ timeout: FIRST_COMPILE_TIMEOUT });
  await page.getByRole("tab", { name: "Write" }).click();
  return page.getByRole("tabpanel", { name: /write/i });
}

async function chooseScore(page: Page, scope: ReturnType<Page["getByRole"]>, label: string, score: string) {
  await scope.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: score, exact: true }).click();
}

test("students write and revise; teachers return and grade with the rubric", async ({ context, page }) => {
  const { teacher, student, classroom } = await seedTeacherClassroom();
  const assignment = await prisma.assignment.create({
    data: {
      classroomId: classroom.id,
      articleId: TEST_ARTICLE_ID,
      writePrompt: "What does the article say ReadWise helps learners do?",
    },
  });

  // Student: draft autosaves, then submit for the class.
  await signInAs(context, student.id);
  let panel = await openWrite(page);
  await expect(panel.getByText("What does the article say ReadWise helps learners do?")).toBeVisible({
    timeout: FIRST_COMPILE_TIMEOUT,
  });
  await expect(panel.getByRole("combobox", { name: "Writing for" })).toContainText(classroom.name);
  await panel.getByLabel("Your response").fill("It helps learners read news.");
  await expect(panel.getByText(/Draft saved/)).toBeVisible({ timeout: 15_000 });
  await panel.getByRole("button", { name: "Submit" }).click();
  await expect(panel.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("Your response")).toHaveAttribute("readonly", "");

  // Teacher: open responses from the classroom and return for revision.
  await signInAs(context, teacher.id);
  await page.goto(`/teacher/classrooms/${classroom.id}`);
  await page.getByRole("link", { name: "Written responses (1)" }).click({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.getByRole("heading", { name: "Written responses", level: 1 })).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.getByText("It helps learners read news.")).toBeVisible();
  let review = page.getByRole("group", { name: `Review for ${student.name}` });
  await chooseScore(page, review, "Claim & focus", "2 / 4");
  await review.getByLabel("Feedback").fill("Add a detail from the article.");
  await review.getByRole("button", { name: "Return for revision" }).click();
  await expect(page.getByText("Waiting for the student to revise.")).toBeVisible();

  // Student: sees the request, revises, resubmits.
  await signInAs(context, student.id);
  panel = await openWrite(page);
  await expect(panel.getByText("Your teacher asked you to revise this response.")).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(panel.getByText("Add a detail from the article.")).toBeVisible();
  await panel.getByLabel("Your response").fill("It helps learners read real English news with confidence.");
  await panel.getByRole("button", { name: "Resubmit" }).click();
  await expect(panel.getByText("Submitted", { exact: true })).toBeVisible();

  // Teacher: grade on every dimension.
  await signInAs(context, teacher.id);
  await page.goto(`/teacher/classrooms/${classroom.id}/assignments/${assignment.id}/responses`);
  review = page.getByRole("group", { name: `Review for ${student.name}` });
  await expect(page.getByText("revision 1")).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  for (const dimension of ["Claim & focus", "Textual evidence", "Organization", "Language & conventions"]) {
    await chooseScore(page, review, dimension, "4 / 4");
  }
  await review.getByRole("button", { name: "Grade (16/16)" }).click();
  await expect(page.getByText("Graded", { exact: true }).first()).toBeVisible();

  // Student: sees the grade.
  await signInAs(context, student.id);
  panel = await openWrite(page);
  await expect(panel.getByText("Your teacher graded this response.")).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(panel.getByText("Total 16/16")).toBeVisible();
});

test("independent writing stays private to the learner", async ({ context, page }) => {
  const { teacher, classroom } = await seedTeacherClassroom();
  const assignment = await prisma.assignment.create({ data: { classroomId: classroom.id, articleId: TEST_ARTICLE_ID } });
  const learner = await createUserWithSession({ role: "Reader" });
  await addSessionCookie(context, learner.sessionToken, learner.expires);

  const panel = await openWrite(page);
  await expect(panel.getByText("Only you can see independent writing.")).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await panel.getByLabel("Your response").fill("My private notes on the article.");
  await panel.getByRole("button", { name: "Submit" }).click();
  await expect(panel.getByText("Submitted", { exact: true })).toBeVisible();

  await signInAs(context, teacher.id);
  await page.goto(`/teacher/classrooms/${classroom.id}/assignments/${assignment.id}/responses`);
  await expect(page.getByText("No responses yet")).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.getByText("My private notes on the article.")).toHaveCount(0);
});
