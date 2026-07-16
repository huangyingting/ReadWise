import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";
import type { APIRequestContext } from "@playwright/test";

const LIST_NAME = "Amsterdam";

async function createNamedListWithArticle(request: APIRequestContext) {
  const createResponse = await request.post("/api/lists", {
    data: { name: LIST_NAME },
  });
  expect(createResponse.ok()).toBe(true);
  const { list } = (await createResponse.json()) as { list: { id: string } };

  const addResponse = await request.post(`/api/lists/${list.id}/items`, {
    data: { articleId: TEST_ARTICLE_ID },
  });
  expect(addResponse.ok()).toBe(true);

  return list;
}

test("desktop named-list controls stay inside the list sidebar", async ({
  readerPage: page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  const list = await createNamedListWithArticle(page.request);

  await page.goto(`/lists?list=${encodeURIComponent(list.id)}`);
  await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible();

  const sidebar = page.locator(".lists-sidebar");
  await expect(sidebar).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: new RegExp(LIST_NAME) }),
  ).toBeVisible();

  const geometry = await sidebar.evaluate((aside, listName) => {
    const panel = document.querySelector<HTMLElement>('[role="tabpanel"]');
    const listLink = Array.from(aside.querySelectorAll<HTMLAnchorElement>("a")).find(
      (link) => link.textContent?.includes(listName),
    );
    const name = listLink
      ? Array.from(listLink.querySelectorAll<HTMLElement>("span")).find(
          (span) => span.textContent?.trim() === listName,
        )
      : null;
    const deleteButton = Array.from(
      aside.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Delete");
    if (!panel || !listLink || !name || !deleteButton) {
      throw new Error("named-list controls unavailable");
    }

    const sidebarRect = aside.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const deleteRect = deleteButton.getBoundingClientRect();

    return {
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      sidebarClientWidth: aside.clientWidth,
      sidebarScrollWidth: aside.scrollWidth,
      sidebarRight: sidebarRect.right,
      panelLeft: panelRect.left,
      deleteRight: deleteRect.right,
      nameClientWidth: name.clientWidth,
      nameScrollWidth: name.scrollWidth,
    };
  }, LIST_NAME);

  expect(geometry.sidebarScrollWidth).toBeLessThanOrEqual(
    geometry.sidebarClientWidth + 1,
  );
  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(
    geometry.bodyClientWidth + 1,
  );
  expect(geometry.deleteRight).toBeLessThanOrEqual(geometry.sidebarRight + 1);
  expect(geometry.panelLeft).toBeGreaterThan(geometry.sidebarRight);
  expect(geometry.nameClientWidth).toBeGreaterThan(0);
  expect(geometry.nameScrollWidth).toBeLessThanOrEqual(
    geometry.nameClientWidth + 1,
  );

  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  });

  const deleteButton = sidebar.getByRole("button", { name: "Delete" });
  await deleteButton.focus();
  await page.keyboard.press("Enter");
  const confirmPanel = sidebar.getByRole("alertdialog", {
    name: "Confirm delete",
  });
  await expect(confirmPanel).toBeVisible();

  const confirmGeometry = await sidebar.evaluate((aside) => {
    const sidebarRect = aside.getBoundingClientRect();
    const confirm = aside.querySelector<HTMLElement>('[role="alertdialog"]');
    if (!confirm) throw new Error("delete confirmation unavailable");
    const confirmRect = confirm.getBoundingClientRect();

    return {
      sidebarClientWidth: aside.clientWidth,
      sidebarScrollWidth: aside.scrollWidth,
      sidebarLeft: sidebarRect.left,
      sidebarRight: sidebarRect.right,
      confirmLeft: confirmRect.left,
      confirmRight: confirmRect.right,
    };
  });

  expect(confirmGeometry.sidebarScrollWidth).toBeLessThanOrEqual(
    confirmGeometry.sidebarClientWidth + 1,
  );
  expect(confirmGeometry.confirmLeft).toBeGreaterThanOrEqual(
    confirmGeometry.sidebarLeft - 1,
  );
  expect(confirmGeometry.confirmRight).toBeLessThanOrEqual(
    confirmGeometry.sidebarRight + 1,
  );

  await page.keyboard.press("Escape");
  await expect(confirmPanel).toHaveCount(0);
  await expect(deleteButton).toBeFocused();
});

test("mobile named-list manager stays within the viewport", async ({
  readerPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const list = await createNamedListWithArticle(page.request);

  await page.goto(`/lists?list=${encodeURIComponent(list.id)}`);
  await page.getByRole("button", { name: `Manage ${LIST_NAME}` }).click();

  const manager = page.getByRole("region", { name: `Manage ${LIST_NAME}` });
  await expect(manager).toBeVisible();
  await expect(manager.getByRole("button", { name: "Rename" })).toBeVisible();
  await expect(
    manager.getByRole("button", { name: "Delete list" }),
  ).toBeVisible();

  const geometry = await manager.evaluate((region) => {
    const rect = region.getBoundingClientRect();
    return {
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
    };
  });

  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(
    geometry.bodyClientWidth + 1,
  );
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
});
