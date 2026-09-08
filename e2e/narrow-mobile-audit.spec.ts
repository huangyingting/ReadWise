import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";
import type { Page } from "@playwright/test";

const NARROW_VIEWPORT = { width: 320, height: 568 };

type OverflowingElement = {
  tag: string;
  text: string;
  left: number;
  right: number;
  width: number;
};

async function expectNoHorizontalOverflow(
  page: Page,
  route: string,
): Promise<void> {
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 60_000 });
  const result = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - viewportWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.position === "fixed"
        ) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > viewportWidth + 1);
      })
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });
    return { overflow, offenders };
  });
  expect(
    result.overflow,
    `${route} horizontally overflows at 320px: ${JSON.stringify(result.offenders)}`,
  ).toBeLessThanOrEqual(1);
}

test.describe("320px reader surfaces", () => {
  test.use({ viewport: NARROW_VIEWPORT, isMobile: true });

  const routes = [
    "/dashboard",
    "/today",
    "/browse",
    "/lists",
    "/settings",
    "/progress",
    "/offline",
    "/study",
    "/notes",
    "/teacher",
    "/assignments",
    `/reader/${TEST_ARTICLE_ID}`,
  ];

  for (const route of routes) {
    test(`${route} stays within a 320px viewport`, async ({
      readerPage: page,
    }) => {
      await page.goto(route);
      await expectNoHorizontalOverflow(page, route);
    });
  }
});

test.describe("320px admin surfaces", () => {
  test.use({ viewport: NARROW_VIEWPORT, isMobile: true });

  for (const route of ["/admin", "/admin/articles", "/admin/members"]) {
    test(`${route} stays within a 320px viewport`, async ({
      adminPage: page,
    }) => {
      await page.goto(route);
      await expectNoHorizontalOverflow(page, route);
    });
  }
});
