import { test, expect, TEST_ARTICLE_ID } from "./support/fixtures";

function createSilentWav(durationSeconds: number): Buffer {
  const sampleRate = 8_000;
  const dataSize = sampleRate * durationSeconds;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  wav.fill(128, 44);
  return wav;
}

const MOCK_AUDIO = createSilentWav(30);

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

test("reader audio controls support seeking on mobile dark mode", async ({
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
        audioUrl: `/api/reader/${TEST_ARTICLE_ID}/speech/audio`,
        mimeType: "audio/mpeg",
        plainText: "Test narration.",
        words: [],
        voice: "e2e-voice",
        cached: false,
        fallback: false,
      }),
    });
  });
  await page.route(/\/api\/reader\/[^/]+\/speech\/audio$/, async (route) => {
    const rangeHeader = route.request().headers().range;
    const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
    if (match) {
      const [, startText, endText] = match;
      const start = startText
        ? Number(startText)
        : Math.max(MOCK_AUDIO.byteLength - Number(endText), 0);
      const end = endText ? Number(endText) : MOCK_AUDIO.byteLength - 1;
      const bytes = MOCK_AUDIO.subarray(start, Math.min(end + 1, MOCK_AUDIO.byteLength));
      await route.fulfill({
        status: 206,
        contentType: "audio/wav",
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(bytes.byteLength),
          "Content-Range": `bytes ${start}-${start + bytes.byteLength - 1}/${MOCK_AUDIO.byteLength}`,
        },
        body: bytes,
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "audio/wav",
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(MOCK_AUDIO.byteLength),
      },
      body: MOCK_AUDIO,
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
  const seek = page.getByRole("slider", { name: "Seek" });
  await expect(seek).toHaveAttribute("aria-valuetext", "0:00 / 0:30");
  await seek.fill("50");
  await expect(seek).toHaveAttribute("aria-valuetext", "0:15 / 0:30");
  await page.getByRole("button", { name: "Skip forward 10 seconds" }).click();
  await expect(seek).toHaveAttribute("aria-valuetext", "0:25 / 0:30");

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
