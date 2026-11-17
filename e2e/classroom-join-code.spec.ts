/**
 * E2E: classroom join codes (#1309).
 *
 * A teacher issues a join code on the classroom page; a signed-in learner
 * redeems it via the shared `/join-class?code=` link (keyboard only) and lands
 * in the class. Also covers field-level errors (malformed, unknown, rotated,
 * expired codes) in Settings → Classes, the signed-out callback, and the
 * mobile + dark rendering of the join page.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { expect, MOBILE_VIEWPORT, test } from "./support/fixtures";
import {
  addSessionCookie,
  createSessionForUser,
  createUserWithSession,
  seedTeacherClassroom,
} from "./support/seed";

/**
 * Parks open pages before switching users: an in-flight `/api/auth/session`
 * response from the previous user's page can otherwise re-set their cookie.
 */
async function resetContext(context: BrowserContext) {
  for (const open of context.pages()) await open.goto("about:blank");
  await context.clearCookies();
}

async function signInAs(context: BrowserContext, userId: string) {
  await resetContext(context);
  const session = await createSessionForUser(userId);
  await addSessionCookie(context, session.sessionToken, session.expires);
}

async function signInNewLearner(context: BrowserContext) {
  await resetContext(context);
  const session = await createUserWithSession({ role: "Reader" });
  await addSessionCookie(context, session.sessionToken, session.expires);
}

/** First hits compile routes on demand under `next dev`; allow for that. */
const FIRST_COMPILE_TIMEOUT = 60_000;
const PREWARM_TIMEOUT = 120_000;

// `next dev` compiles each route on first hit, and a cold compile mid-test can
// outlast assertion deadlines or trigger a Fast Refresh full reload. Compile
// this spec's pages and APIs up front with a throwaway session. The join API
// gets an empty body (400 validation) so no rate-limit budget is spent.
test.beforeAll(async ({ playwright }, testInfo) => {
  testInfo.setTimeout(PREWARM_TIMEOUT * 2);
  const session = await createUserWithSession({ role: "Reader" });
  const api = await playwright.request.newContext({
    baseURL: testInfo.project.use.baseURL,
    extraHTTPHeaders: { cookie: `next-auth.session-token=${session.sessionToken}` },
  });
  for (const path of ["/join-class", "/settings", "/teacher/classrooms/prewarm", "/api/classrooms/prewarm/join-code"]) {
    await api.get(path, { timeout: PREWARM_TIMEOUT });
  }
  await api.post("/api/classrooms/join", { data: {}, timeout: PREWARM_TIMEOUT });
  await api.dispose();
});

async function issueCode(page: Page, classroomId: string, buttonName: RegExp): Promise<string> {
  await page.goto(`/teacher/classrooms/${classroomId}`);
  await page.getByRole("button", { name: buttonName }).click();
  const code = page.getByLabel("Classroom join code");
  await expect(page.getByText("Active", { exact: true })).toBeVisible({ timeout: FIRST_COMPILE_TIMEOUT });
  return (await code.textContent())!.trim();
}

test("teacher issues a join code and a learner joins with the shared link", async ({
  context,
  page,
}) => {
  const { teacher, classroom } = await seedTeacherClassroom();
  await signInAs(context, teacher.id);
  const code = await issueCode(page, classroom.id, /Generate code/);
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  await signInNewLearner(context);
  await page.goto(`/join-class?code=${code}`);
  await expect(page.getByRole("heading", { name: "Join a class" })).toBeVisible();
  const input = page.getByLabel("Class code");
  await expect(input).toHaveValue(code);

  // Keyboard-only: focus the field and submit with Enter. A press that lands
  // before hydration does a plain GET that keeps the code, so retry until the
  // hydrated form handles it.
  const joinedStatus = page.getByRole("status").filter({ hasText: `You joined ${classroom.name}` });
  await expect(async () => {
    await expect(input).toHaveValue(code);
    await input.focus();
    await expect(input).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(joinedStatus).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: FIRST_COMPILE_TIMEOUT });

  // Joining again is idempotent.
  await input.fill(code.toLowerCase());
  await page.getByRole("button", { name: "Join class" }).click();
  await expect(page.getByRole("status").filter({ hasText: `You’re already in ${classroom.name}` })).toBeVisible();

  await page.getByRole("link", { name: "See your assignments" }).click();
  await expect(page).toHaveURL(/\/assignments$/);

  await signInAs(context, teacher.id);
  await page.goto(`/teacher/classrooms/${classroom.id}`);
  await expect(page.getByText(/1 joined/)).toBeVisible();
});

test("malformed, unknown, rotated, and expired codes show a clear field error", async ({ context, page }) => {
  const { teacher, classroom } = await seedTeacherClassroom();
  await signInAs(context, teacher.id);
  const first = await issueCode(page, classroom.id, /Generate code/);
  await page.getByRole("button", { name: /Rotate code/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "The previous code no longer works" })).toBeVisible();
  const rotated = (await page.getByLabel("Classroom join code").textContent())!.trim();
  expect(rotated).not.toBe(first);

  await signInNewLearner(context);
  await page.goto("/settings#classes");
  const input = page.getByLabel("Join a class");
  const submit = page.getByRole("button", { name: "Join class" });

  // Ambiguous characters are caught locally and flagged on the field.
  await input.fill("ABCD-0000");
  await submit.click();
  await expect(page.getByText("Class codes are 8 letters and numbers, like ABCD-2345.")).toBeVisible();
  await expect(input).toHaveAttribute("aria-invalid", "true");

  for (const attempt of ["ZZZZ-ZZZZ", first]) {
    await input.fill(attempt);
    await submit.click();
    await expect(page.getByText("That class code isn't valid. Check it with your teacher.")).toBeVisible();
    await expect(input).toHaveAttribute("aria-invalid", "true");
  }

  await prisma.classroomJoinCode.update({
    where: { classroomId: classroom.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await input.fill(rotated);
  await submit.click();
  await expect(page.getByText("That class code has expired. Ask your teacher for a new one.")).toBeVisible();

  await prisma.classroomJoinCode.update({
    where: { classroomId: classroom.id },
    data: { expiresAt: null },
  });
  await input.fill(rotated);
  await submit.click();
  await expect(page.getByRole("status").filter({ hasText: `You joined ${classroom.name}` })).toBeVisible();
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
});

test("signed-out visitors keep the code through sign-in", async ({ page }) => {
  await page.goto("/join-class?code=ABCD-2345");
  await expect(page).toHaveURL(/\/signin\?callbackUrl=/, { timeout: FIRST_COMPILE_TIMEOUT });
  expect(decodeURIComponent(new URL(page.url()).searchParams.get("callbackUrl") ?? "")).toBe(
    "/join-class?code=ABCD-2345",
  );
});

test("join page renders on mobile in dark theme", async ({ context, page }) => {
  await signInNewLearner(context);
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/join-class");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect(page.getByRole("heading", { name: "Join a class" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join class" })).toBeDisabled();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
