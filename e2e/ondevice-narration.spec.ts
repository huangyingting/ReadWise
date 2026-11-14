/**
 * On-device narration (Paradee-8M): the default Listen path synthesizes audio
 * in a browser worker from self-hosted model files, plays it through the
 * shared <audio> element, and drives the prose word highlight. Speech
 * credentials are cleared by playwright.config.ts, so no cloud audio exists.
 */
import { expect, test, TEST_ARTICLE_ID } from "./support/fixtures";

test("Listen plays on-device narration with word highlighting", async ({ page, signIn }, testInfo) => {
  test.setTimeout(240_000);
  const consoleLines: string[] = [];
  const cspViolations: string[] = [];
  const failures: string[] = [];
  const cloudNarrationRequests: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    consoleLines.push(`[${message.type()}] ${text}`);
    if (/Content Security Policy|Refused to/i.test(text)) cspViolations.push(text);
  });
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("requestfailed", (request) => failures.push(`${request.url()} ${request.failure()?.errorText}`));
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(`/api/reader/${TEST_ARTICLE_ID}/speech`)) {
      cloudNarrationRequests.push(request.url());
    }
  });

  try {
    await signIn();
    await page.goto(`/reader/${TEST_ARTICLE_ID}`);
    const modelRequest = page.waitForResponse((res) =>
      res.url().endsWith("/models/paradee-8m-v1.3/paradee_int8.onnx"),
    );
    let textStatus = 0;
    page.on("response", (res) => {
      if (res.url().endsWith(`/api/reader/${TEST_ARTICLE_ID}/speech/text`)) textStatus = res.status();
    });

    // A cold dev server may still be compiling and hot-reloading the first
    // page; retry the click until the narration request actually starts.
    await page.waitForLoadState("networkidle");
    await expect(async () => {
      await page.getByRole("button", { name: "Listen to this article" }).first().click({ timeout: 10_000 });
      await expect.poll(() => textStatus, { timeout: 10_000 }).not.toBe(0);
    }).toPass({ timeout: 120_000 });

    expect(textStatus).toBe(200);
    expect((await modelRequest).status()).toBe(200);

    // A blob: WAV source appears once the first snapshot is synthesized.
    await expect
      .poll(() => page.evaluate(() => document.querySelector("audio")?.getAttribute("src") ?? ""), {
        timeout: 180_000,
      })
      .toMatch(/^blob:/);

    // Playback advances and the active-word CSS highlight is applied to the prose.
    await expect
      .poll(() => page.evaluate(() => document.querySelector("audio")?.currentTime ?? 0), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0.5);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
            return Boolean(registry?.has("tts-active"));
          }),
        { timeout: 30_000 },
      )
      .toBe(true);

    // Longer snapshots replace the source without restarting playback.
    const samples: Array<{ src: string; time: number; duration: number; paused: boolean }> = [];
    await expect
      .poll(
        async () => {
          samples.push(
            await page.evaluate(() => {
              const audio = document.querySelector("audio");
              return {
                src: audio?.getAttribute("src") ?? "",
                time: audio?.currentTime ?? 0,
                duration: Number.isFinite(audio?.duration) ? (audio?.duration ?? 0) : 0,
                paused: audio?.paused ?? true,
              };
            }),
          );
          return new Set(samples.map((s) => s.src)).size;
        },
        { timeout: 60_000, intervals: [250] },
      )
      .toBeGreaterThan(1);
    await expect
      .poll(() => page.evaluate(() => document.querySelector("audio")?.currentTime ?? 0), { timeout: 15_000 })
      .toBeGreaterThan(samples.at(-1)!.time);
    // Ignore samples taken inside the millisecond reload gap before
    // loadedmetadata restores the position; playback was already > 0.5 s.
    const settled = samples.filter((sample) => sample.time >= 0.05);
    for (let i = 1; i < settled.length; i++) {
      expect(settled[i]!.time).toBeGreaterThanOrEqual(settled[i - 1]!.time - 0.3);
    }
    await expect
      .poll(() => page.evaluate(() => document.querySelector("audio")?.duration ?? 0), { timeout: 15_000 })
      .toBeGreaterThan(settled[0]!.duration);
    expect(cloudNarrationRequests).toEqual([]);
    expect(cspViolations).toEqual([]);
    expect(failures.filter((f) => !/net::ERR_ABORTED/.test(f))).toEqual([]);
  } finally {
    await testInfo.attach("console", { body: consoleLines.join("\n"), contentType: "text/plain" });
  }
});

const READER_PREFS_KEY = "readwise:reader-prefs";

test("cloud preference falls back to on-device when no cloud audio exists", async ({ page, signIn }) => {
  test.setTimeout(240_000);
  // Cloud is attempted first; with Speech unconfigured it has no audio (or,
  // on a cold dev server, may time out) and on-device takes over either way.
  const cloudRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(`/api/reader/${TEST_ARTICLE_ID}/speech`)) {
      cloudRequests.push(request.url());
    }
  });
  await page.addInitScript(
    ([key, prefs]) => window.localStorage.setItem(key, prefs),
    [
      READER_PREFS_KEY,
      JSON.stringify({ mode: "light", fontScale: 1, narration: "cloud", narrationVoice: "bm_fable", narrationSpeed: 1.25 }),
    ] as const,
  );
  await signIn();
  await page.goto(`/reader/${TEST_ARTICLE_ID}`);
  await page.getByRole("button", { name: "Listen to this article" }).first().click();

  await expect
    .poll(() => page.evaluate(() => document.querySelector("audio")?.getAttribute("src") ?? ""), { timeout: 180_000 })
    .toMatch(/^blob:/);
  expect(cloudRequests).toHaveLength(1);
  await expect
    .poll(() => page.evaluate(() => document.querySelector("audio")?.playbackRate ?? 0), { timeout: 15_000 })
    .toBe(1.25);
  await expect(page.getByRole("combobox", { name: "Playback speed" })).toHaveText(/1\.25/);
});

test("Settings narration preferences save per browser and preview a voice", async ({ page, signIn }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signIn();
  await page.goto("/settings#narration");

  const card = page.locator("#narration");
  await expect(card.getByRole("heading", { name: "Narration" })).toBeVisible();
  await card.getByRole("radio", { name: "Cloud" }).click();
  await card.getByRole("combobox", { name: "Voice" }).click();
  await page.getByRole("option", { name: /Isabella/ }).click();
  await card.getByRole("combobox", { name: "Default speed" }).click();
  await page.getByRole("option", { name: "0.75×" }).click();

  const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "{}"), READER_PREFS_KEY);
  expect(stored).toMatchObject({ narration: "cloud", narrationVoice: "bf_isabella", narrationSpeed: 0.75 });

  await page.reload();
  await expect(card.getByRole("radio", { name: "Cloud" })).toHaveAttribute("aria-checked", "true");
  await expect(card.getByRole("combobox", { name: "Voice" })).toHaveText(/Isabella/);

  const preview = card.getByRole("button", { name: /Preview Isabella/ });
  await preview.click();
  await expect(preview).toBeDisabled();
  await expect(preview).toBeEnabled({ timeout: 180_000 });
  await expect(card.getByRole("alert")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
