/**
 * English G2P and same-origin model fetching for on-device narration:
 * eSpeak-NG + Misaki phonemization, and Cache Storage–backed asset loading.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { fetchCachedBytes, ONDEVICE_TTS_CACHE_NAME, phonemizeParadeeEnglish, toMisaki } from "@/lib/ondevice-tts/paradee-g2p";
import type { ModelLoadProgress } from "@/lib/ondevice-tts/types";

const globals = globalThis as unknown as { caches?: unknown; fetch: typeof fetch };
const originalFetch = globals.fetch;

afterEach(() => {
  globals.fetch = originalFetch;
  delete globals.caches;
});

function streamedResponse(chunks: number[][], headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

describe("English phonemization", () => {
  test("phonemizes unpunctuated and punctuated text and handles empty input", async () => {
    assert.equal(await phonemizeParadeeEnglish("   "), "");
    const plain = await phonemizeParadeeEnglish("Hello world");
    assert.match(plain, /^h.*l.*w/);
    const punctuated = await phonemizeParadeeEnglish("Hello, world.");
    assert.match(punctuated, /,/);
    assert.match(punctuated, /\.$/);
    assert.notEqual(await phonemizeParadeeEnglish("Hello", true), "");
  });

  test("toMisaki applies British-only rules", () => {
    assert.equal(toMisaki("ðɪ kˈiə", true), "ði kˈɪə");
    assert.equal(toMisaki("bˈɐtə", false), "bˈətə");
  });
});

describe("fetchCachedBytes", () => {
  test("streams with progress when Cache Storage is unavailable", async () => {
    const progress: ModelLoadProgress[] = [];
    globals.fetch = async () => streamedResponse([[1, 2], [3]], { "content-length": "3" });
    const result = await fetchCachedBytes("/model.onnx", { progressCallback: (p) => progress.push(p) });
    assert.deepEqual(Array.from(result), [1, 2, 3]);
    assert.deepEqual(progress.map((p) => [p.file, p.loaded, p.total]), [
      ["model.onnx", 2, 3],
      ["model.onnx", 3, 3],
    ]);
  });

  test("reads whole responses without a length or progress callback", async () => {
    const progress: ModelLoadProgress[] = [];
    globals.fetch = async () => new Response(new Uint8Array([9, 8]));
    assert.deepEqual(Array.from(await fetchCachedBytes("/a.bin", { fileLabel: "a", progressCallback: (p) => progress.push(p) })), [9, 8]);
    assert.deepEqual(progress, [{ file: "a", loaded: 2, total: 2, progress: 100 }]);
    assert.deepEqual(Array.from(await fetchCachedBytes("/a.bin")), [9, 8]);
  });

  test("rejects HTTP errors", async () => {
    globals.fetch = async () => new Response("missing", { status: 404 });
    await assert.rejects(() => fetchCachedBytes("/models/x.onnx"), /Failed to fetch x\.onnx \(HTTP 404\)/);
  });

  test("serves cache hits and stores misses in the on-device cache", async () => {
    const store = new Map<string, Response>();
    const opened: string[] = [];
    globals.caches = {
      open: async (name: string) => {
        opened.push(name);
        return {
          match: async (url: string) => store.get(url)?.clone(),
          put: async (url: string, response: Response) => void store.set(url, response),
        };
      },
    };
    let fetches = 0;
    globals.fetch = async () => {
      fetches++;
      return new Response(new Uint8Array([4, 5]), { headers: { "content-type": "application/octet-stream" } });
    };

    assert.deepEqual(Array.from(await fetchCachedBytes("/m.onnx")), [4, 5]);
    const progress: ModelLoadProgress[] = [];
    assert.deepEqual(Array.from(await fetchCachedBytes("/m.onnx", { progressCallback: (p) => progress.push(p) })), [4, 5]);
    assert.equal(fetches, 1);
    assert.deepEqual(progress, [{ file: "m.onnx", loaded: 2, total: 2, progress: 100 }]);
    assert.ok(opened.every((name) => name === ONDEVICE_TTS_CACHE_NAME));
  });

  test("treats Cache Storage failures as best-effort", async () => {
    globals.fetch = async () => new Response(new Uint8Array([7]));
    globals.caches = { open: async () => Promise.reject(new Error("blocked")) };
    assert.deepEqual(Array.from(await fetchCachedBytes("/x")), [7]);

    globals.caches = {
      open: async () => ({
        match: async () => undefined,
        put: async () => Promise.reject(new Error("quota")),
      }),
    };
    assert.deepEqual(Array.from(await fetchCachedBytes("/y")), [7]);
  });
});
