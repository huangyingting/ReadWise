import { test, expect } from "./support/fixtures";
import { selectDropdownOption } from "./support/select-dropdown";

test("admin section picker navigates without mobile overflow", async ({
  adminPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");

  const nav = page.getByRole("navigation", { name: "Admin sections" });
  const sectionPicker = page.getByRole("combobox", { name: "Admin section" });
  await expect(sectionPicker).toBeVisible();
  await expect(sectionPicker).toHaveAttribute("data-value", "/admin");

  const overflow = await nav.evaluate((element) => ({
    nav: element.scrollWidth - element.clientWidth,
    page:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  }));
  expect(overflow.nav).toBeLessThanOrEqual(1);
  expect(overflow.page).toBeLessThanOrEqual(1);

  await selectDropdownOption(page, "Admin section", "Articles");
  await expect(page).toHaveURL(/\/admin\/articles$/);
  await expect(page.getByRole("heading", { name: "Articles" })).toBeVisible();
});

test("admin section tabs wrap without compact desktop overflow", async ({
  adminPage: page,
}) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/admin");

  const nav = page.getByRole("navigation", { name: "Admin sections" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Admin section" }),
  ).toBeHidden();

  const geometry = await nav.evaluate((element) => {
    const track = element.querySelector<HTMLElement>(".admin-subnav-track");
    const links = Array.from(element.querySelectorAll<HTMLElement>("a"));
    if (!track || links.length === 0) {
      throw new Error("admin section tabs unavailable");
    }

    return {
      navOverflow: element.scrollWidth - element.clientWidth,
      pageOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      trackOverflow: track.scrollWidth - track.clientWidth,
      rowCount: new Set(links.map((link) => Math.round(link.offsetTop))).size,
    };
  });

  expect(geometry.navOverflow).toBeLessThanOrEqual(1);
  expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
  expect(geometry.trackOverflow).toBeLessThanOrEqual(1);
  expect(geometry.rowCount).toBeGreaterThan(1);
});