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
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa"] as const;
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
        (v) => {
          const nodes = v.nodes
            .map(
              (node, index) =>
                `  ${index + 1}. target=${node.target.join(" ")} html=${node.html}`,
            )
            .join("\n");

          return `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))\n${nodes}`;
        },
      )
      .join("\n");
    throw new Error(
      `Accessibility violations (serious/critical) found:\n${summary}`,
    );
  }
}

async function signIn(
  context: BrowserContext,
  options: Parameters<typeof createUserWithSession>[0] = {},
) {
  const { sessionToken, expires } = await createUserWithSession(options);
  await addSessionCookie(context, sessionToken, expires);
}

async function analyzePage(page: Page) {
  return new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
}

async function selectReaderPhrase(page: Page, phrase: string) {
  await page.locator(".word-lookup-prose").evaluate((prose, targetPhrase) => {
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      const start = text.indexOf(targetPhrase);
      if (start >= 0) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + targetPhrase.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      node = walker.nextNode();
    }
    throw new Error(`Could not find reader phrase: ${targetPhrase}`);
  }, phrase);
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

    const results = await analyzePage(page);

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
    await signIn(context);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const results = await analyzePage(page);

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
    await signIn(context);

    await page.goto(`/reader/${TEST_ARTICLE_ID}`);
    await expect(
      page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
    ).toBeVisible();

    const results = await analyzePage(page);

    assertNoBlockingViolations(results);
  });

  test("reader toolbar buttons are keyboard-focusable", async ({
    context,
    page,
  }) => {
    await signIn(context);

    await page.goto(`/reader/${TEST_ARTICLE_ID}`);
    await expect(page.getByLabel("Display settings")).toBeVisible();

    // Tab into the toolbar area and confirm focus reaches the Display settings button.
    const displayBtn = page.getByLabel("Display settings");
    await displayBtn.focus();
    await expect(displayBtn).toBeFocused();
  });

  test("selection toolbar traps Tab and returns focus on Escape", async ({
    context,
    page,
  }) => {
    await signIn(context);

    await page.goto(`/reader/${TEST_ARTICLE_ID}`);
    await expect(
      page.getByRole("heading", { name: "E2E Critical Reading Smoke Article" }),
    ).toBeVisible();

    await selectReaderPhrase(page, "ReadWise");
    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "e",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const toolbar = page.getByRole("toolbar", { name: "Text actions" });
    await expect(toolbar).toBeVisible();
    await expect(page.getByRole("radio", { name: "Yellow" })).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Define" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(toolbar).toBeHidden();
    await expect(page.locator(".word-lookup-prose")).toBeFocused();
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
    await signIn(context, {
      role: "Admin",
    });

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const results = await analyzePage(page);

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
    await signIn(context);

    await page.goto("/teacher");
    // Accept either a loaded teaching page or an empty/redirect state.
    await page.waitForSelector("main, [role='main'], h1", { timeout: 10_000 });

    const results = await analyzePage(page);

    assertNoBlockingViolations(results);
  });
});
