/**
 * E2E: classroom guided prompts and evidence sharing (#1307).
 *
 * A teacher turns one of their highlights into a class prompt for an
 * assignment; the student sees the numbered prompt on the passage, replies,
 * and explicitly shares one of their own highlights as evidence; the teacher
 * reviews replies and evidence without ever seeing the student's private
 * highlight note.
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
    `/api/reader/${TEST_ARTICLE_ID}/annotations`,
    `/api/reader/${TEST_ARTICLE_ID}/highlights`,
    "/teacher/classrooms/prewarm/assignments/prewarm/annotations",
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

/** Creates a personal highlight on `quote` through the API, anchored against the rendered prose. */
async function highlightPassage(page: Page, quote: string, note?: string) {
  const prose = page.locator(".word-lookup-prose").first();
  await expect(prose).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  const text = (await prose.textContent()) ?? "";
  const startOffset = text.indexOf(quote);
  expect(startOffset).toBeGreaterThanOrEqual(0);
  const res = await page.request.post(`/api/reader/${TEST_ARTICLE_ID}/highlights`, {
    data: {
      quote,
      startOffset,
      endOffset: startOffset + quote.length,
      prefix: text.slice(Math.max(0, startOffset - 32), startOffset),
      suffix: text.slice(startOffset + quote.length, startOffset + quote.length + 32),
      ...(note ? { note } : {}),
    },
  });
  expect(res.status()).toBe(201);
}

async function openNotes(page: Page) {
  await page.getByRole("button", { name: "Practice tools", exact: true }).click({ timeout: FIRST_COMPILE_TIMEOUT });
  await page.getByRole("tab", { name: "Notes" }).click();
  return page.getByRole("tabpanel", { name: /notes/i });
}

test("teachers pin prompts; students reply and share evidence; teachers review", async ({ context, page }) => {
  const { teacher, student, classroom } = await seedTeacherClassroom();
  const assignment = await prisma.assignment.create({ data: { classroomId: classroom.id, articleId: TEST_ARTICLE_ID } });

  // Teacher: highlight a passage and turn it into a class prompt.
  await signInAs(context, teacher.id);
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(page.getByText("Guide your class: highlight a passage")).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await highlightPassage(page, "real English news");
  await page.reload();
  let notes = await openNotes(page);
  await notes.getByRole("button", { name: "Add class prompt" }).click({ timeout: FIRST_COMPILE_TIMEOUT });
  await notes.getByLabel("Prompt for students").fill("What makes news reading hard for learners?");
  await notes.getByRole("button", { name: "Add prompt" }).click();
  await expect(notes.getByRole("heading", { name: "Prompt 1" })).toBeVisible();
  await expect(notes.getByText("What makes news reading hard for learners?")).toBeVisible();
  await expect(page.locator('mark.rw-guide[data-guide-number="1"]')).toHaveText("real English news");

  // Student: sees the numbered prompt on the passage, replies, and shares evidence.
  await signInAs(context, student.id);
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(page.getByText("Your teacher added 1 prompt to this article.")).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.locator('mark.rw-guide[data-guide-number="1"]')).toHaveAttribute(
    "aria-description",
    "Teacher prompt 1: What makes news reading hard for learners?",
  );
  await highlightPassage(page, "sanitized HTML rendering", "secret private note");
  await page.reload();
  await page.getByRole("button", { name: "Open class prompts" }).click({ timeout: FIRST_COMPILE_TIMEOUT });
  notes = page.getByRole("tabpanel", { name: /notes/i });
  await notes.getByLabel("Your reply to prompt 1").fill("Unfamiliar idioms slow me down.");
  await notes.getByRole("button", { name: "Send reply" }).click();
  await expect(notes.getByRole("list", { name: "Your replies to prompt 1" })).toContainText("Unfamiliar idioms slow me down.");

  await notes.getByRole("button", { name: "Share as evidence" }).click();
  await notes.getByLabel("Why this is evidence (optional)").fill("Shows the reader handles HTML safely.");
  await notes.getByRole("button", { name: "Share with teacher" }).click();
  await expect(notes.getByText("Shared with your teacher.")).toBeVisible();
  await expect(notes.getByRole("list", { name: "Evidence shared with your teacher" })).toContainText("sanitized HTML rendering");

  // Teacher: reviews replies and evidence from the classroom page.
  await signInAs(context, teacher.id);
  await page.goto(`/teacher/classrooms/${classroom.id}`);
  await page.getByRole("link", { name: "Prompts & evidence (2)" }).click({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.getByRole("heading", { name: "Prompts & evidence", level: 1 })).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.getByRole("list", { name: "Replies to prompt 1" })).toContainText("Unfamiliar idioms slow me down.");
  const evidence = page.getByRole("list", { name: "Other shared evidence" });
  await expect(evidence).toContainText("sanitized HTML rendering");
  await expect(evidence).toContainText("Shows the reader handles HTML safely.");
  await expect(page.getByText("secret private note")).toHaveCount(0);
  expect(page.url()).toContain(`/assignments/${assignment.id}/annotations`);

  // Teacher: edits, then deletes the prompt from the reader.
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  notes = await openNotes(page);
  await notes.getByRole("button", { name: "Edit prompt 1" }).click({ timeout: FIRST_COMPILE_TIMEOUT });
  await notes.getByLabel("Prompt", { exact: true }).fill("Which words are hardest here?");
  await notes.getByRole("button", { name: "Save prompt" }).click();
  await expect(notes.getByText("Which words are hardest here?")).toBeVisible();
  await notes.getByRole("button", { name: "Delete prompt 1" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(notes.getByRole("heading", { name: "Prompt 1" })).toHaveCount(0);
  await expect(page.locator("mark.rw-guide")).toHaveCount(0);
});

test("readers outside the class see no prompts and cannot reply", async ({ context, page }) => {
  const { teacher, classroom } = await seedTeacherClassroom();
  const assignment = await prisma.assignment.create({ data: { classroomId: classroom.id, articleId: TEST_ARTICLE_ID } });
  await prisma.assignmentAnnotation.create({
    data: {
      assignmentId: assignment.id,
      authorId: teacher.id,
      quote: "real English news",
      startOffset: 0,
      endOffset: 17,
      prompt: "Class-only prompt",
    },
  });
  const outsider = await createUserWithSession({ role: "Reader" });
  await addSessionCookie(context, outsider.sessionToken, outsider.expires);

  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expect(page.locator(".word-lookup-prose").first()).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  const res = await page.request.get(`/api/reader/${TEST_ARTICLE_ID}/annotations`);
  expect(await res.json()).toEqual({ teaching: [], learning: [], guides: [], responses: [] });
  await expect(page.locator("mark.rw-guide")).toHaveCount(0);
  await expect(page.getByText("Class-only prompt")).toHaveCount(0);

  const reply = await page.request.post(`/api/assignments/${assignment.id}/annotation-responses`, { data: { body: "x" } });
  expect(reply.status()).toBe(404);
  const review = await page.request.get(`/api/assignments/${assignment.id}/annotations`);
  expect(review.status()).toBe(403);
});
