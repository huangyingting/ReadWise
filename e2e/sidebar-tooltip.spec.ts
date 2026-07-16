import { test, expect } from "./support/fixtures";

test("all sidebar controls fit a short desktop viewport without scrolling", async ({
  adminPage: page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await expect(sidebar).toBeVisible();

  const readGeometry = () => sidebar.evaluate((aside) => {
    const nav = aside.querySelector<HTMLElement>('nav[aria-label="Primary"]');
    const controls = Array.from(
      aside.querySelectorAll<HTMLElement>("a[href], button"),
    );
    if (!nav || controls.length === 0) {
      throw new Error("sidebar controls unavailable");
    }

    const sidebarRect = aside.getBoundingClientRect();
    const controlRects = controls.map((control) =>
      control.getBoundingClientRect(),
    );

    return {
      controlCount: controls.length,
      navClientHeight: nav.clientHeight,
      navScrollHeight: nav.scrollHeight,
      firstControlTop: Math.min(...controlRects.map((rect) => rect.top)),
      lastControlBottom: Math.max(...controlRects.map((rect) => rect.bottom)),
      sidebarTop: sidebarRect.top,
      sidebarBottom: sidebarRect.bottom,
    };
  });

  const geometries = [await readGeometry()];

  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  geometries.push(await readGeometry());

  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  });
  geometries.push(await readGeometry());

  for (const geometry of geometries) {
    expect(geometry.controlCount).toBe(15);
    expect(geometry.navScrollHeight).toBeLessThanOrEqual(
      geometry.navClientHeight + 1,
    );
    expect(geometry.firstControlTop).toBeGreaterThanOrEqual(
      geometry.sidebarTop,
    );
    expect(geometry.lastControlBottom).toBeLessThanOrEqual(
      geometry.sidebarBottom,
    );
  }
});

test("tooltips wrap and stay outside the collapsed sidebar scroll container", async ({
  readerPage: page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // Normal tooltips wrap by default within the tokenized maximum width.
  const themeToggle = page.getByRole("button", { name: /Switch to/ });
  await themeToggle.hover();
  const wrappedTooltip = page.getByRole("tooltip");
  await expect(wrappedTooltip).toBeVisible();
  const wrappedStyles = await wrappedTooltip.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      whiteSpace: style.whiteSpace,
      maxWidth: Number.parseFloat(style.maxWidth),
    };
  });
  expect(wrappedStyles.whiteSpace).toBe("normal");
  expect(wrappedStyles.maxWidth).toBeGreaterThan(0);

  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");

  const browseLink = sidebar.getByRole("link", { name: "Browse" });
  await browseLink.hover();
  const railTooltip = page.getByRole("tooltip");
  await expect(railTooltip).toHaveText("Browse");
  await expect(railTooltip).toBeVisible();

  const geometry = await page.evaluate(() => {
    const aside = document.querySelector<HTMLElement>('aside[aria-label="Sidebar"]');
    const nav = aside?.querySelector<HTMLElement>('nav[aria-label="Primary"]');
    const trigger = nav?.querySelector<HTMLElement>('a[href="/browse"]');
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
    if (!aside || !nav || !trigger || !tooltip) {
      throw new Error("sidebar tooltip geometry unavailable");
    }

    return {
      bodyHasHorizontalOverflow: document.body.scrollWidth > document.body.clientWidth,
      navHasHorizontalOverflow: nav.scrollWidth > nav.clientWidth,
      navScrollbarWidth: getComputedStyle(nav).scrollbarWidth,
      tooltipIsPortaled: tooltip.parentElement === document.body,
      tooltipLeft: tooltip.getBoundingClientRect().left,
      triggerRight: trigger.getBoundingClientRect().right,
    };
  });

  expect(geometry.bodyHasHorizontalOverflow).toBe(false);
  expect(geometry.navHasHorizontalOverflow).toBe(false);
  expect(geometry.navScrollbarWidth).toBe("none");
  expect(geometry.tooltipIsPortaled).toBe(true);
  expect(geometry.tooltipLeft).toBeGreaterThan(geometry.triggerRight);
});
