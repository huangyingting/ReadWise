/**
 * E2E: Text Sets (#1308).
 *
 * A teacher builds a shared text set in the editor (search, add, reorder,
 * guiding note), assigns it to a classroom, and sees the unit rollup; a
 * colleague in the same organization sees it under "Shared at my
 * organization" while a teacher from another organization cannot open it; the
 * student sees the readings grouped as a unit with the essential question.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { expect, test } from "./support/fixtures";
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
  for (const path of ["/teacher/text-sets", "/teacher/text-sets/new", "/teacher/text-sets/prewarm", "/assignments"]) {
    await api.get(path, { timeout: PREWARM_TIMEOUT });
  }
  await api.get("/api/text-sets/article-options?organizationId=prewarm", { timeout: PREWARM_TIMEOUT });
  await api.dispose();
});

async function signInAs(context: BrowserContext, userId: string) {
  for (const open of context.pages()) await open.goto("about:blank");
  await context.clearCookies();
  const session = await createSessionForUser(userId);
  await addSessionCookie(context, session.sessionToken, session.expires);
}

async function addArticle(page: Page, title: string) {
  await page.getByLabel("Find articles").fill(title);
  await page.getByRole("button", { name: `Add ${title}` }).click({ timeout: FIRST_COMPILE_TIMEOUT });
}

test("teachers build, share, and assign a text set; students see the unit", async ({ context, page }) => {
  const { teacher, student, classroom } = await seedTeacherClassroom();
  const colleague = await prisma.user.create({ data: { id: "e2e-colleague", name: "E2E Colleague", role: "Reader" } });
  await prisma.membership.create({ data: { userId: colleague.id, orgId: classroom.orgId, role: "Teacher" } });
  const otherOrg = await prisma.organization.create({ data: { id: "e2e-other-org", name: "Other Org", slug: "e2e-other-org" } });
  const outsider = await prisma.user.create({ data: { id: "e2e-outsider", name: "E2E Outsider", role: "Reader" } });
  await prisma.membership.create({ data: { userId: outsider.id, orgId: otherOrg.id, role: "Teacher" } });

  await signInAs(context, teacher.id);
  await page.goto("/teacher");
  await page.getByRole("link", { name: "Text sets" }).click({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.getByRole("heading", { name: "Text sets", level: 1 })).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await page.getByRole("link", { name: "New text set" }).first().click();

  await page.getByLabel("Title").fill("Reading the news");
  await page.getByLabel("Essential question").fill("How do we read news critically?");
  await page.getByRole("combobox", { name: "Sharing" }).click();
  await page.getByRole("option", { name: "Shared with my organization" }).click();
  await addArticle(page, "E2E World News Practice");
  await addArticle(page, "E2E Critical Reading Smoke Article");
  await page.getByRole("button", { name: "Move E2E Critical Reading Smoke Article up" }).click();
  await page.getByLabel("Guiding note for reading 1").fill("Find the main claim.");
  await page.getByRole("button", { name: "Create text set" }).click();

  await expect(page).toHaveURL(/\/teacher\/text-sets\/(?!new)[^/]+$/, { timeout: FIRST_COMPILE_TIMEOUT });
  const setUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: "Reading the news", level: 1 })).toBeVisible();
  const readings = page.getByRole("list").filter({ has: page.getByLabel("Guiding note for reading 1") });
  await expect(readings.getByRole("listitem").first()).toContainText("E2E Critical Reading Smoke Article");

  await page.getByRole("button", { name: "Assign to classes" }).click();
  const sheet = page.getByRole("dialog", { name: "Assign text set" });
  await sheet.getByRole("button", { name: classroom.name }).click();
  await sheet.getByRole("button", { name: /Assign to 1 class/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Assigned 2 readings to 1 class." })).toBeVisible();

  await page.goto(`/teacher/classrooms/${classroom.id}`);
  await expect(page.getByRole("heading", { name: "Text set units" })).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.getByRole("link", { name: "Reading the news" })).toBeVisible();

  await signInAs(context, colleague.id);
  await page.goto("/teacher/text-sets?tab=shared");
  await expect(page.getByRole("link", { name: "Reading the news" })).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await page.goto(setUrl);
  await expect(page.getByRole("button", { name: "Duplicate" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0, { timeout: 1 });

  await signInAs(context, outsider.id);
  // Streaming pages render the not-found boundary (soft 404) — the set never shows.
  await page.goto(setUrl);
  await expect(page.getByText("Page not found")).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(page.getByText("Reading the news")).toHaveCount(0);

  await signInAs(context, student.id);
  await page.goto("/assignments");
  const unit = page.getByRole("region", { name: "Reading the news" });
  await expect(unit).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  await expect(unit).toContainText("How do we read news critically?");
  await expect(unit).toContainText("0 of 2 done");
  await expect(unit.getByRole("listitem").first()).toContainText("E2E Critical Reading Smoke Article");
  await expect(unit).toContainText("Find the main claim.");
});
