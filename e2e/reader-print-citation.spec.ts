/**
 * E2E: reader citations and printable classroom packets (#1306).
 *
 * A reader copies MLA/APA/Chicago citations from the reader header and opens
 * the chrome-free print view (numbered paragraphs, toolbar hidden in print
 * media). The worksheet adds the student header, stored vocabulary and quiz;
 * the answer key is refused for a reader and shown to a teacher; a
 * rights-restricted article is not printable.
 */
import type { BrowserContext } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { expect, TEST_ARTICLE_ID, test } from "./support/fixtures";
import {
  addSessionCookie,
  createSessionForUser,
  createUserWithSession,
  seedTeacherClassroom,
} from "./support/seed";

const PRINT_URL = `/reader/${TEST_ARTICLE_ID}/print`;
const FIRST_COMPILE_TIMEOUT = 60_000;
const PREWARM_TIMEOUT = 120_000;

// Compile this spec's pages up front so cold `next dev` compiles don't eat
// assertion deadlines (see classroom-join-code.spec.ts).
test.beforeAll(async ({ playwright }, testInfo) => {
  testInfo.setTimeout(PREWARM_TIMEOUT * 2);
  const session = await createUserWithSession({ role: "Reader" });
  const api = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
    extraHTTPHeaders: { cookie: `next-auth.session-token=${session.sessionToken}` },
  });
  for (const path of [`/reader/${TEST_ARTICLE_ID}`, PRINT_URL, `${PRINT_URL}?mode=worksheet`]) {
    await api.get(path, { timeout: PREWARM_TIMEOUT });
  }
  await api.dispose();
});

async function seedStudyMaterial() {
  await prisma.quizQuestion.create({
    data: {
      articleId: TEST_ARTICLE_ID,
      question: "What does ReadWise help learners read?",
      options: ["Recipes", "Real English news", "Poetry"],
      correctIndex: 1,
    },
  });
  await prisma.vocabularyItem.create({
    data: {
      articleId: TEST_ARTICLE_ID,
      word: "confidence",
      explanation: "a feeling that you can do something well",
      example: "She reads with confidence.",
    },
  });
}

async function signInTeacher(context: BrowserContext) {
  for (const open of context.pages()) await open.goto("about:blank");
  await context.clearCookies();
  const { teacher } = await seedTeacherClassroom();
  const session = await createSessionForUser(teacher.id);
  await addSessionCookie(context, session.sessionToken, session.expires);
}

test("reader copies citations from the reader header", async ({ context, readerPage: page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await page.getByRole("button", { name: "Cite" }).click({ timeout: FIRST_COMPILE_TIMEOUT });

  const dialog = page.getByRole("dialog", { name: "Cite this article" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "MLA 9" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "APA 7" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Chicago" })).toBeVisible();
  await expect(dialog).toContainText("“E2E Critical Reading Smoke Article.”");

  await dialog.getByRole("button", { name: "Copy APA 7 citation" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Citation copied.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(
    "QA, R. (2026, January 15). E2E Critical Reading Smoke Article. E2E News. https://example.com/e2e-critical-reader",
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Cite" })).toBeFocused();
});

test("print view is chrome-free with numbered paragraphs and a print-hidden toolbar", async ({
  readerPage: page,
}) => {
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  const printLink = page.getByRole("link", { name: "Print" });
  await expect(printLink).toHaveAttribute("href", PRINT_URL, { timeout: FIRST_COMPILE_TIMEOUT });
  await printLink.click();
  await expect(page).toHaveURL(new RegExp(`${PRINT_URL}$`), { timeout: FIRST_COMPILE_TIMEOUT });

  await expect(page.getByRole("heading", { level: 1, name: "E2E Critical Reading Smoke Article" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await expect(page.locator(".print-source")).toHaveText(
    "Source: QA, ReadWise. “E2E Critical Reading Smoke Article.” E2E News, 15 Jan. 2026, example.com/e2e-critical-reader.",
  );
  const numbers = await page
    .locator(".print-article-body > p")
    .evaluateAll((paragraphs) =>
      paragraphs.map((paragraph) => getComputedStyle(paragraph, "::before").content),
    );
  // Computed `content` reports the counter expression rather than its value.
  expect(numbers).toEqual(["counter(print-paragraph)", "counter(print-paragraph)"]);

  const layouts = page.getByRole("navigation", { name: "Packet layout" });
  await expect(layouts.getByRole("link")).toHaveText(["Article only", "Article + vocabulary & quiz"]);
  await expect(layouts.getByRole("link", { name: "Article only" })).toHaveAttribute("aria-current", "page");

  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("worksheet adds the student header, vocabulary, quiz bubbles, and lined response", async ({
  readerPage: page,
}) => {
  await seedStudyMaterial();
  await page.goto(`${PRINT_URL}?mode=worksheet`);
  await expect(page.getByLabel("Student details")).toContainText("Name");
  await expect(page.getByRole("heading", { name: "Vocabulary" })).toBeVisible();
  await expect(page.getByText("a feeling that you can do something well")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quiz" })).toBeVisible();
  await expect(page.getByText("B. Real English news")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Write about it" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Answer key" })).toHaveCount(0);
});

test("the answer key is refused for readers and printed for teachers", async ({ context, readerPage: page }) => {
  await seedStudyMaterial();
  await page.goto(`${PRINT_URL}?mode=answer-key`);
  await expect(page).toHaveURL(/\/forbidden$/, { timeout: FIRST_COMPILE_TIMEOUT });

  await signInTeacher(context);
  await page.goto(`${PRINT_URL}?mode=answer-key`);
  const layouts = page.getByRole("navigation", { name: "Packet layout" });
  await expect(layouts.getByRole("link", { name: "Article + quiz + answer key" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const key = page.locator("section", { has: page.getByRole("heading", { name: "Answer key" }) });
  await expect(key).toContainText("B. Real English news");
});

test("rights-restricted articles are not printable", async ({ readerPage: page }) => {
  await prisma.article.update({ where: { id: TEST_ARTICLE_ID }, data: { takedownState: "takedown" } });
  try {
    await page.goto(PRINT_URL);
    await expect(page.getByText("This article can’t be printed")).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
    await expect(page.getByRole("button", { name: "Print" })).toHaveCount(0);
    await expect(page.locator(".print-article-body")).toHaveCount(0);
  } finally {
    await prisma.article.update({ where: { id: TEST_ARTICLE_ID }, data: { takedownState: "active" } });
  }
});
