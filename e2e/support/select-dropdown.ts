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
  await combobox.click();

  const option = page.getByRole("option", {
    name: optionName,
    exact: typeof optionName === "string",
  });
  await expect(option).toBeVisible();
  await option.click();

  return combobox;
}
