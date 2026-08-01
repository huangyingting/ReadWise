import { expect, type Page } from "@playwright/test";

/**
 * Select an option through the shared visual Select control. Use this instead
 * of Playwright's native-only `selectOption()` for product dropdowns.
 */
export async function selectDropdownOption(
  page: Page,
  label: string | RegExp,
  optionName: string | RegExp,
) {
  const combobox = page.getByRole("combobox", { name: label });
  await expect(combobox).toBeVisible();
  await expect(combobox).toHaveAttribute("aria-controls", /.+/, {
    timeout: 30_000,
  });

  const listboxId = await combobox.getAttribute("aria-controls");
  if (!listboxId) {
    throw new Error(`Select ${String(label)} does not control a listbox`);
  }
  await combobox.click();
  const option = page
    .locator(`[role="listbox"][id=${JSON.stringify(listboxId)}]`)
    .getByRole("option", {
      name: optionName,
      exact: typeof optionName === "string",
    });
  await expect(option).toBeVisible();
  await option.click();

  return combobox;
}
