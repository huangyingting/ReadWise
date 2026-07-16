import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";

const MOCK_AUDIO_BASE64 = "SUQzBAAAAAAA";

test("shared dropdown preserves keyboard navigation and GET form submission", async ({
  readerPage: page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard");

  const levelSelect = page.getByRole("combobox", { name: "Level" });
  await expect(levelSelect).toBeVisible();
  await expect(levelSelect).toHaveJSProperty("tagName", "BUTTON");
  await expect(page.locator("select:visible")).toHaveCount(0);

  await levelSelect.focus();
  await page.keyboard.press("ArrowDown");

  const lastOption = page.getByRole("option", { name: "C2 and below" });
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("End");
  await expect(lastOption).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/dashboard\?level=C2$/);
  await expect(
    page.getByRole("combobox", { name: "Level" }),
  ).toHaveAttribute("data-value", "C2");
});

test("playback speed uses the compact shared dropdown on mobile dark mode", async ({
  readerPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function play() {
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      this.dispatchEvent(new Event("pause"));
    };
  });
  await page.route(/\/api\/reader\/[^/]+\/speech$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        audio: MOCK_AUDIO_BASE64,
        mimeType: "audio/mpeg",
        plainText: "Test narration.",
        words: [],
        voice: "e2e-voice",
        cached: false,
        fallback: false,
      }),
    });
  });

  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await page
    .getByRole("button", { name: "Listen to this article" })
    .click();

  await expect(page.getByRole("region", { name: "Audio player" })).toBeVisible();
  const speedSelect = page.getByRole("combobox", { name: "Playback speed" });
  await expect(speedSelect).toHaveAttribute("data-value", "1");
  await speedSelect.click();

  const listbox = page.getByRole("listbox");
  const panel = page.getByRole("dialog", { name: "Select options" });
  await expect(listbox).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(5);

  const geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      right: rect.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(100);
  expect(geometry.width).toBeLessThanOrEqual(120);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);

  await page.getByRole("option", { name: "1.25×" }).click();
  await expect(speedSelect).toHaveAttribute("data-value", "1.25");
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")?.playbackRate ?? 0),
    )
    .toBe(1.25);
});
