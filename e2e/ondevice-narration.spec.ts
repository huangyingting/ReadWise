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
    const textRequest = page.waitForResponse((res) =>
      res.url().endsWith(`/api/reader/${TEST_ARTICLE_ID}/speech/text`),
    );

    await page.getByRole("button", { name: "Listen to this article" }).first().click();

    expect((await textRequest).status()).toBe(200);
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
