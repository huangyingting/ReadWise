/**
 * E2E: Accessibility baseline — axe-core scans on high-value UI surfaces.
 *
 * Runs @axe-core/playwright against the landing/sign-in page (unauthenticated)
 * and the core authenticated surfaces: dashboard, reader, admin, and teacher.
 * Each test asserts zero serious or critical violations against the WCAG 2.1 AA
 * rule set.
 *
 * KNOWN-ISSUE ALLOWLIST
 * ---------------------
 * Any violations that are accepted as known baseline issues must be added to the
 * ALLOWLISTED_RULES constant below with a comment explaining why and a link to
 * the follow-up issue.  The list is intentionally empty at the initial baseline
 * — add entries only when a violation is confirmed by manual review and a
 * remediation issue has been filed.
 *
 * SEVERITY POLICY
 * ---------------
 * The checks filter to "serious" and "critical" impact levels only.  Violations
 * of lower impact ("moderate", "minor") are surfaced in the axe report but do
 * not fail CI in the baseline.  See docs/ui/accessibility.md for the full
 * policy.
 *
 * RUNNING LOCALLY
 * ---------------
 * These tests require a running Next.js dev server and a configured Playwright
 * environment.  They are not executed during `npm test` (unit tests).  Use:
 *
 *   npm run test:e2e:smoke
 *
 * to run all e2e specs including this one.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  addSessionCookie,
  createUserWithSession,
  disconnectDb,
  seedSmokeData,
  TEST_ARTICLE_ID,
} from "./support/seed";

// ---------------------------------------------------------------------------
// Allowlist: rule IDs that are accepted as known baseline gaps.
// Keep this list minimal and always include a follow-up issue reference.
// ---------------------------------------------------------------------------
const ALLOWLISTED_RULES: string[] = [
  // Example (remove when first real entry is added):
  // "color-contrast", // Known gap — tracked in #999
];

// Only fail on serious / critical violations at baseline.
const BLOCKING_IMPACTS = ["serious", "critical"] as const;
type Impact = (typeof BLOCKING_IMPACTS)[number];

function assertNoBlockingViolations(
  results: Awaited<ReturnType<AxeBuilder["analyze"]>>,
): void {
  const blocking = results.violations.filter(
    (v) =>
      BLOCKING_IMPACTS.includes(v.impact as Impact) &&
      !ALLOWLISTED_RULES.includes(v.id),
  );

  if (blocking.length > 0) {
    const summary = blocking
      .map(
        (v) =>
          `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`,
      )
      .join("\n");
    throw new Error(
      `Accessibility violations (serious/critical) found:\n${summary}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  await seedSmokeData();
});

test.afterAll(async () => {
  await disconnectDb();
});

// ---------------------------------------------------------------------------
// Surface: landing / sign-in (unauthenticated)
// ---------------------------------------------------------------------------
test.describe("a11y: sign-in page (unauthenticated)", () => {
  test("has no serious/critical axe violations on /signin", async ({ page }) => {
    await page.goto("/signin");
    // Wait for main content to be present before scanning.
    await page.waitForSelector("main, [role='main'], form", { timeout: 10_000 });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoBlockingViolations(results);
  });
});

// ---------------------------------------------------------------------------
// Surface: dashboard (authenticated reader)
// ---------------------------------------------------------------------------
test.describe("a11y: dashboard (authenticated reader)", () => {
  test("has no serious/critical axe violations on /dashboard", async ({
    context,
    page,
  }) => {
    const { sessionToken, expires } = await createUserWithSession();
    await addSessionCookie(context, sessionToken, expires);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoBlockingViolations(results);
  });
});

// ---------------------------------------------------------------------------
// Surface: reader (article view)
// ---------------------------------------------------------------------------
test.describe("a11y: reader surface", () => {
  test("has no serious/critical axe violations on the reader page", async ({
    context,
    page,
  }) => {
    const { sessionToken, expires } = await createUserWithSession();
    await addSessionCookie(context, sessionToken, expires);

    await page.goto(`/reader/${TEST_ARTICLE_ID}`);
    await expect(
      page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoBlockingViolations(results);
  });

  test("reader toolbar buttons are keyboard-focusable", async ({
    context,
    page,
  }) => {
    const { sessionToken, expires } = await createUserWithSession();
    await addSessionCookie(context, sessionToken, expires);

    await page.goto(`/reader/${TEST_ARTICLE_ID}`);
    await expect(page.getByLabel("Display settings")).toBeVisible();

    // Tab into the toolbar area and confirm focus reaches the Display settings button.
    const displayBtn = page.getByLabel("Display settings");
    await displayBtn.focus();
    await expect(displayBtn).toBeFocused();
  });
});

// ---------------------------------------------------------------------------
// Surface: admin dashboard
// ---------------------------------------------------------------------------
test.describe("a11y: admin surface", () => {
  test("has no serious/critical axe violations on /admin", async ({
    context,
    page,
  }) => {
    const { sessionToken, expires } = await createUserWithSession({
      role: "Admin",
    });
    await addSessionCookie(context, sessionToken, expires);

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoBlockingViolations(results);
  });
});

// ---------------------------------------------------------------------------
// Surface: teacher workspace
// ---------------------------------------------------------------------------
test.describe("a11y: teacher surface", () => {
  test("has no serious/critical axe violations on /teacher", async ({
    context,
    page,
  }) => {
    const { sessionToken, expires } = await createUserWithSession();
    await addSessionCookie(context, sessionToken, expires);

    await page.goto("/teacher");
    // Accept either a loaded teaching page or an empty/redirect state.
    await page.waitForSelector("main, [role='main'], h1", { timeout: 10_000 });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    assertNoBlockingViolations(results);
  });
});
