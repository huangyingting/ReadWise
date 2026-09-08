import AxeBuilder from "@axe-core/playwright";
import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";
import type { Page } from "@playwright/test";

const AUDIT_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;
const BLOCKING_IMPACTS = new Set(["moderate", "serious", "critical"]);

async function expectNoModerateViolations(
  page: Page,
  route: string,
): Promise<void> {
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 60_000 });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const blocking = results.violations
    .filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ""))
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target),
    }));
  expect(blocking, `${route} accessibility violations`).toEqual([]);
}

for (const viewport of AUDIT_VIEWPORTS) {
  test.describe(`${viewport.name} expanded accessibility`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.name === "mobile",
    });

    for (const route of [
      "/dashboard",
      "/today",
      "/settings",
      `/reader/${TEST_ARTICLE_ID}`,
    ]) {
      test(`${route} has no moderate-or-higher violations`, async ({
        readerPage: page,
      }) => {
        await page.goto(route);
        await expectNoModerateViolations(page, route);
      });
    }

    test("/admin has no moderate-or-higher violations", async ({
      adminPage: page,
    }) => {
      await page.goto("/admin");
      await expectNoModerateViolations(page, "/admin");
    });
  });
}
