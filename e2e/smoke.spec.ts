import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import {
  addSessionCookie,
  createSessionForUser,
  createUserWithSession,
  seedTeacherClassroom,
} from "./support/seed";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";

type SessionSeed = {
  sessionToken: string;
  expires: Date;
};

async function openSessionPage(
  browser: Browser,
  session: SessionSeed,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await addSessionCookie(context, session.sessionToken, session.expires);
  const page = await context.newPage();
  return { context, page };
}

async function expectSeededReader(page: Page) {
  await expect(page).toHaveURL(new RegExp(`/reader/${TEST_ARTICLE_ID}$`));
  await expect(
    page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
  ).toBeVisible();
}

test("shows onboarding for an authenticated reader without a profile", async ({
  signIn,
  page,
}) => {
  await signIn({
    onboarded: false,
  });

  await page.goto("/onboarding");
  await expect(
    page.getByRole("heading", { name: "Welcome to ReadWise" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your English level" })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("opens dashboard, browse, reader, and admin with a seeded admin session", async ({
  adminPage: page,
}) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "For You" })).toBeVisible();
  await expect(page.getByRole("link", { name: /E2E Critical Reading/ })).toBeVisible();

  await page.goto("/browse");
  await expect(page.getByRole("heading", { name: "Browse" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "All categories" })).toBeVisible();
  const articleLink = page.getByRole("link", { name: /E2E Critical Reading/ }).first();
  await expect(articleLink).toHaveAttribute("href", `/reader/${TEST_ARTICLE_ID}`);

  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await expectSeededReader(page);
  await expect(page.getByLabel("Display settings")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Practice tools", exact: true }),
  ).toBeVisible();

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Overview")).toBeVisible();
  await expect(page.getByText(/Signed in as/)).toBeVisible();
});

test("assignment lifecycle round trip updates student and teacher progress", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { teacher, student, classroom } = await seedTeacherClassroom();
  const [teacherSession, studentSession, outsiderSession] = await Promise.all([
    createSessionForUser(teacher.id),
    createSessionForUser(student.id),
    createUserWithSession({ role: "Reader" }),
  ]);

  const teacherActor = await openSessionPage(browser, teacherSession);
  const studentActor = await openSessionPage(browser, studentSession);
  const outsiderActor = await openSessionPage(browser, outsiderSession);

  const { context: teacherContext, page: teacherPage } = teacherActor;
  const { context: studentContext, page: studentPage } = studentActor;
  const { context: outsiderContext, page: outsiderPage } = outsiderActor;

  try {
    await studentPage.goto("/assignments");
    await expect(studentPage.getByRole("heading", { name: "Assignments" })).toBeVisible();
    await expect(studentPage.getByText("No assignments yet")).toBeVisible();

    await studentPage.goto(`/teacher/classrooms/${classroom.id}`);
    await expect(studentPage).toHaveURL(/\/forbidden$/);

    await teacherPage.goto(`/teacher/classrooms/${classroom.id}`);
    await expect(teacherPage.getByRole("heading", { name: "E2E Reading Group" })).toBeVisible();
    await expect(teacherPage.getByText("No assignments yet.")).toBeVisible();

    await teacherPage
      .getByRole("button", { name: /E2E Critical Reading Smoke Article/ })
      .click();
    await teacherPage.getByLabel("Instructions (optional)").fill("Read and summarize the article.");
    const assignmentResponsePromise = teacherPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/classrooms/${classroom.id}/assignments`),
    );
    await teacherPage.getByRole("button", { name: "Assign article" }).click();
    const assignmentResponse = await assignmentResponsePromise;
    expect(assignmentResponse.status()).toBe(201);
    const assignmentPayload = (await assignmentResponse.json()) as {
      assignment: { id: string };
    };

    const teacherPendingRow = teacherPage
      .locator("li")
      .filter({ hasText: "E2E Critical Reading Smoke Article" })
      .filter({ hasText: /0\/1 done/ })
      .first();
    await expect(teacherPendingRow).toBeVisible({ timeout: 60_000 });

    await studentPage.goto("/assignments");
    const studentAssignmentRow = studentPage
      .locator("li")
      .filter({ hasText: "E2E Critical Reading Smoke Article" })
      .first();
    const assignmentLink = studentAssignmentRow.getByRole("link", {
      name: "E2E Critical Reading Smoke Article",
    });
    await expect(assignmentLink).toBeVisible({ timeout: 60_000 });
    await expect(assignmentLink).toHaveAttribute("href", `/reader/${TEST_ARTICLE_ID}`);
    await expect(studentAssignmentRow).toContainText("Read and summarize the article.");

    await studentPage.goto(`/reader/${TEST_ARTICLE_ID}`);
    await expectSeededReader(studentPage);

    await studentPage.goto("/assignments");
    const markComplete = studentAssignmentRow.getByRole("button", {
      name: "Mark complete",
    });

    let releaseFailureRequest: () => void = () => {};
    const failureRequestGate = new Promise<void>((resolve) => {
      releaseFailureRequest = () => resolve();
    });
    await studentPage.route(
      "**/api/assignments/*/completion",
      async (route) => {
        await failureRequestGate;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Temporary completion outage" }),
        });
      },
      { times: 1 },
    );
    await markComplete.click();
    await expect(studentAssignmentRow.getByRole("button", { name: "Saving…" })).toBeVisible();
    releaseFailureRequest();
    await expect(studentAssignmentRow.getByText("Temporary completion outage")).toBeVisible();
    await expect(markComplete).toBeVisible();

    let releaseSuccessRequest: () => void = () => {};
    const successRequestGate = new Promise<void>((resolve) => {
      releaseSuccessRequest = () => resolve();
    });
    await studentPage.route(
      "**/api/assignments/*/completion",
      async (route) => {
        await successRequestGate;
        await route.continue();
      },
      { times: 1 },
    );
    await markComplete.click();
    await expect(studentAssignmentRow.getByRole("button", { name: "Saving…" })).toBeVisible();
    releaseSuccessRequest();
    await expect(studentAssignmentRow.getByText("Completed").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(studentAssignmentRow.getByRole("button", { name: "Mark complete" })).toHaveCount(0);

    await teacherPage.reload();
    const teacherCompleteRow = teacherPage
      .locator("li")
      .filter({ hasText: "E2E Critical Reading Smoke Article" })
      .filter({ hasText: /1\/1 done/ })
      .first();
    await expect(teacherCompleteRow).toBeVisible({ timeout: 60_000 });

    await outsiderPage.goto("/assignments");
    await expect(outsiderPage.getByRole("heading", { name: "Assignments" })).toBeVisible();
    await expect(outsiderPage.getByText("No assignments yet")).toBeVisible();

    const outsiderAttempt = await outsiderPage.request.post(
      `/api/assignments/${assignmentPayload.assignment.id}/completion`,
      { data: { status: "COMPLETED" } },
    );
    expect(outsiderAttempt.status()).toBe(404);
  } finally {
    await Promise.all([
      teacherContext.close(),
      studentContext.close(),
      outsiderContext.close(),
    ]);
  }
});

test.describe("mobile-ish reader", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });

  test("keeps core reading controls usable on a narrow viewport", async ({
    signIn,
    mobilePage: page,
  }) => {
    await signIn();

    await page.goto(`/reader/${TEST_ARTICLE_ID}`);
    await expectSeededReader(page);

    await page.getByLabel("Display settings").click();
    await expect(
      page.getByRole("dialog", { name: "Display settings" }),
    ).toBeVisible();
    await expect(page.getByLabel("Increase text size")).toBeVisible();

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  });
});
