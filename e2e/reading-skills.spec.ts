/**
 * E2E: reading skills and maturity bands (#1302).
 *
 * A learner submits a skill-tagged quiz and sees each question's skill badge
 * and answer rationale; Browse filters by content maturity and reading skill;
 * a teacher sees the classroom Reading skills matrix and can export it.
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
  for (const path of [`/reader/${TEST_ARTICLE_ID}`, "/browse", "/teacher/classrooms/prewarm"]) {
    await api.get(path, { timeout: PREWARM_TIMEOUT });
  }
  await api.dispose();
});

async function seedSkillQuiz() {
  return Promise.all([
    prisma.quizQuestion.create({
      data: {
        articleId: TEST_ARTICLE_ID,
        question: "What is the main idea of the article?",
        options: ["Cooking tips", "Reading real news with confidence"],
        correctIndex: 1,
        skillTag: "main_idea",
        standardCode: "CCRA.R.2",
        explanation: "The first paragraph says ReadWise helps learners read real news.",
      },
    }),
    prisma.quizQuestion.create({
      data: {
        articleId: TEST_ARTICLE_ID,
        question: "What does the word 'seeded' mean here?",
        options: ["Planted", "Prepared in advance"],
        correctIndex: 1,
        skillTag: "vocabulary_in_context",
        standardCode: "CCRA.R.4",
      },
    }),
  ]);
}

async function signInAs(context: BrowserContext, userId: string) {
  for (const open of context.pages()) await open.goto("about:blank");
  await context.clearCookies();
  const session = await createSessionForUser(userId);
  await addSessionCookie(context, session.sessionToken, session.expires);
}

/** The shared Select is a listbox combobox, not a native <select>. */
async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function openQuiz(page: Page) {
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await page.getByRole("button", { name: "Practice tools", exact: true }).click({ timeout: FIRST_COMPILE_TIMEOUT });
  await page.getByRole("tab", { name: "Quiz" }).click();
}

test("learners see skill badges and answer rationales after submitting a quiz", async ({ readerPage: page }) => {
  await seedSkillQuiz();
  await openQuiz(page);

  const panel = page.getByRole("tabpanel", { name: /quiz/i });
  await panel.getByLabel("Reading real news with confidence").check({ timeout: FIRST_COMPILE_TIMEOUT });
  await panel.getByLabel("Planted").check();
  await expect(panel.getByText("R.2 · Main idea & summary")).toHaveCount(0);

  await panel.getByRole("button", { name: "Check answers" }).click();
  await expect(panel.getByText("R.2 · Main idea & summary")).toBeVisible();
  await expect(panel.getByText("R.4 · Vocabulary in context")).toBeVisible();
  await expect(panel.getByText("The first paragraph says ReadWise helps learners read real news.")).toBeVisible();

  await expect
    .poll(() => prisma.quizAttemptAnswer.count({ where: { attempt: { articleId: TEST_ARTICLE_ID } } }), {
      timeout: FIRST_COMPILE_TIMEOUT,
    })
    .toBe(2);
});

test("browse filters by content maturity and reading skill", async ({ readerPage: page }) => {
  await seedSkillQuiz();
  await prisma.article.update({ where: { id: TEST_ARTICLE_ID }, data: { maturityBand: "high_school" } });

  await page.goto("/browse");
  const heading = "E2E Critical Reading Smoke Article";
  await expect(page.getByText(heading).first()).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });

  await choose(page, "Suitable for", "Middle school");
  await expect(page).toHaveURL(/maturity=middle_school/);
  await expect(page.getByText(heading)).toHaveCount(0);

  await choose(page, "Suitable for", "All audiences");
  await expect(page).not.toHaveURL(/maturity=/);
  await choose(page, "Reading skill", "Main idea & summary");
  await expect(page).toHaveURL(/skill=main_idea/);
  await expect(page.getByText(heading).first()).toBeVisible();

  await choose(page, "Reading skill", "Argument & claims");
  await expect(page).toHaveURL(/skill=argument/);
  await expect(page.getByText(heading)).toHaveCount(0);
});

test("teachers see the classroom reading-skills matrix and can export it", async ({ context, page }) => {
  const questions = await seedSkillQuiz();
  const { teacher, student, classroom } = await seedTeacherClassroom();
  await prisma.assignment.create({ data: { classroomId: classroom.id, articleId: TEST_ARTICLE_ID } });
  await prisma.quizAttempt.create({
    data: {
      userId: student.id,
      articleId: TEST_ARTICLE_ID,
      correctCount: 1,
      totalQuestions: 2,
      scorePct: 50,
      answers: {
        create: [
          { questionId: questions[0].id, questionIndex: 0, skillTag: "main_idea", selectedIndex: 1, correct: true },
          {
            questionId: questions[1].id,
            questionIndex: 1,
            skillTag: "vocabulary_in_context",
            selectedIndex: 0,
            correct: false,
          },
        ],
      },
    },
  });

  await signInAs(context, teacher.id);
  await page.goto(`/teacher/classrooms/${classroom.id}`);
  const table = page.getByRole("table", { name: "Reading skills by student" });
  await expect(table).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  const studentRow = table.getByRole("row", { name: new RegExp(student.name ?? "E2E Student") });
  await expect(studentRow).toContainText("100%");
  await expect(studentRow).toContainText("0%");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the matrix scrolls inside its card instead of widening the page").toBeLessThanOrEqual(1);

  const exportLink = page.locator(`a[href="/api/classrooms/${classroom.id}/skills?format=csv"]`);
  await expect(exportLink).toHaveText("Export CSV");
  const csv = await page.request.get(`/api/classrooms/${classroom.id}/skills?format=csv`);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("CCRA.R.2 Main idea & summary");
});
