/**
 * ParadeeTTS engine behaviour with the ONNX Runtime helpers mocked: model
 * loading, WebGPU→WASM fallback at session creation and at run time,
 * phoneme-run splitting, voice selection, and output conversion. Live model
 * synthesis is covered by ondevice-tts-paradee.test.ts.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, mock, test } from "node:test";

type FakeSession = {
  providers: string[];
  run: (feeds: Record<string, { data: unknown; dims: readonly number[] }>) => Promise<Record<string, { data: unknown }>>;
  release: () => Promise<void>;
};

const encoder = new TextEncoder();
// Minimal ModelProto: graph (field 7) containing only a name.
const MODEL_BYTES = new Uint8Array([(7 << 3) | 2, 3, 0x0a, 0x01, 0x67]);
const CONFIG = { sample_rate: 24_000, voices: ["af_heart", "bf_isabella", "am_puck", "bm_fable"], vocab: { h: 1, I: 2, " ": 3, ".": 4 } };

let sessions: FakeSession[] = [];
let webgpuCreateFails = false;
let webgpuRunFails = false;
let releaseFails = false;
let phonemes = "hI.";
let phonemizeCalls: Array<{ text: string; british: boolean }> = [];
let fetched: string[] = [];
let runFeeds: Array<Record<string, { data: unknown; dims: readonly number[] }>> = [];
let omitDurations = false;
let plainArrayOutputs = false;

function makeSession(providers: string[]): FakeSession {
  return {
    providers,
    run: async (feeds) => {
      runFeeds.push(feeds);
      if (providers.includes("webgpu") && webgpuRunFails) throw new Error("webgpu kernel failed");
      const seqLen = feeds.input_ids!.dims[1]!;
      const waveform = plainArrayOutputs ? [0.1, -0.1] : new Float32Array([0.1, -0.1]);
      const durations = plainArrayOutputs ? Array(seqLen).fill(1) : new Float32Array(seqLen).fill(1);
      return {
        waveform: { data: waveform },
        ...(omitDurations ? {} : { "/Clip_output_0": { data: durations } }),
      };
    },
    release: async () => {
      if (releaseFails) throw new Error("already released");
    },
  };
}

before(() => {
  mock.module("@/lib/ondevice-tts/paradee-g2p", {
    namedExports: {
      ONDEVICE_TTS_ASSET_PATHS: { modelConfig: "/config.json", model: "/model.onnx" },
      fetchCachedBytes: async (url: string, options: { progressCallback?: (info: unknown) => void }) => {
        fetched.push(url);
        options.progressCallback?.({ file: url, loaded: 1, total: 1, progress: 100 });
        return url.endsWith(".json") ? encoder.encode(JSON.stringify(CONFIG)) : MODEL_BYTES;
      },
      createSerializedOrtSession: async (_bytes: Uint8Array, options: { executionProviders?: string[] }) => {
        const providers = options.executionProviders ?? [];
        if (providers.includes("webgpu") && webgpuCreateFails) throw new Error("no webgpu backend");
        const session = makeSession(providers);
        sessions.push(session);
        return session;
      },
      runSerializedOrtSession: (session: FakeSession, feeds: Record<string, { data: unknown; dims: readonly number[] }>) =>
        session.run(feeds),
      phonemizeParadeeEnglish: async (text: string, british: boolean) => {
        phonemizeCalls.push({ text, british });
        return phonemes;
      },
    },
  });
});

beforeEach(() => {
  sessions = [];
  webgpuCreateFails = false;
  webgpuRunFails = false;
  releaseFails = false;
  phonemes = "hI.";
  phonemizeCalls = [];
  fetched = [];
  runFeeds = [];
  omitDurations = false;
  plainArrayOutputs = false;
});

async function loadEngine() {
  return import("@/lib/ondevice-tts/paradee");
}

describe("ParadeeTTS session selection", () => {
  test("load() fetches config + model and runs on WebGPU when available", async () => {
    const { ParadeeTTS } = await loadEngine();
    const progress: unknown[] = [];
    const tts = await ParadeeTTS.load({ device: "webgpu", progressCallback: (info) => progress.push(info) });
    assert.equal(tts.device, "webgpu");
    assert.equal(tts.sampleRate, 24_000);
    assert.deepEqual(fetched.sort(), ["/config.json", "/model.onnx"]);
    assert.equal(progress.length, 2);
    assert.deepEqual(sessions.map((s) => s.providers), [["webgpu"]]);
  });

  test("falls back to WASM when the WebGPU session cannot be created", async () => {
    const { ParadeeTTS } = await loadEngine();
    webgpuCreateFails = true;
    const tts = await ParadeeTTS.load({ device: "webgpu" });
    assert.equal(tts.device, "wasm");
    assert.deepEqual(sessions.map((s) => s.providers), [["wasm"]]);
  });

  test("rebuilds the session on WASM when a WebGPU kernel fails at run time", async () => {
    const { ParadeeTTS } = await loadEngine();
    webgpuRunFails = true;
    releaseFails = true;
    const tts = await ParadeeTTS.load({ device: "webgpu" });
    const out = await tts.generate("Hi.", { voice: "am_puck" });
    assert.equal(tts.device, "wasm");
    assert.deepEqual(sessions.map((s) => s.providers), [["webgpu"], ["wasm"]]);
    assert.equal(out.samples.length, 2);
  });

  test("WASM run failures propagate", async () => {
    const { ParadeeTTS } = await loadEngine();
    const tts = await ParadeeTTS.load({ device: "wasm" });
    sessions[0]!.run = async () => {
      throw new Error("wasm failed");
    };
    await assert.rejects(() => tts.generate("Hi."), /wasm failed/);
  });
});

describe("ParadeeTTS.generate", () => {
  test("encodes vocab ids with the voice index and returns tokens + durations", async () => {
    const { ParadeeTTS } = await loadEngine();
    const tts = await ParadeeTTS.load({ device: "wasm" });
    phonemes = "hI.x"; // "x" is outside the vocabulary and is dropped
    const out = await tts.generate("Hi.", { voice: "am_puck", speed: 1.2 });
    assert.deepEqual(phonemizeCalls, [{ text: "Hi.", british: false }]);
    const feeds = runFeeds[0]!;
    assert.deepEqual(Array.from(feeds.input_ids!.data as BigInt64Array, Number), [0, 1, 2, 4, 0]);
    assert.deepEqual(Array.from(feeds.voice!.data as BigInt64Array, Number), [2]);
    assert.ok(Math.abs((feeds.speed!.data as Float32Array)[0]! - 1.2) < 1e-6);
    assert.deepEqual(out.tokens, ["$", "h", "I", ".", "$"]);
    assert.equal(out.durations?.length, 5);
  });

  test("uses British phonemization for en-GB voices and the default voice for unknown ids", async () => {
    const { ParadeeTTS } = await loadEngine();
    const tts = await ParadeeTTS.load({ device: "wasm" });
    await tts.generate("Hi.", { voice: "bm_fable" });
    await tts.generate("Hi.", { voice: "zz_unknown" });
    assert.deepEqual(phonemizeCalls.map((c) => c.british), [true, false]);
    assert.deepEqual(Array.from(runFeeds[1]!.voice!.data as BigInt64Array, Number), [0]);
  });

  test("splits phoneme strings longer than 510 symbols at spaces, hard-cutting space-free runs", async () => {
    const { ParadeeTTS } = await loadEngine();
    const tts = await ParadeeTTS.load({ device: "wasm" });
    phonemes = Array.from({ length: 200 }, () => "hI").join(" ") + " " + "h".repeat(600);
    const out = await tts.generate("long");
    // ~510 + ~90 symbols at spaces, then the space-free 600-symbol tail is cut at 510.
    assert.equal(runFeeds.length, 4);
    for (const feeds of runFeeds) assert.ok(feeds.input_ids!.dims[1]! <= 512);
    assert.equal(out.samples.length, 8);
    assert.equal(out.tokens?.length, out.durations?.length);
  });

  test("returns silence when nothing is speakable and tolerates missing durations", async () => {
    const { ParadeeTTS } = await loadEngine();
    const tts = await ParadeeTTS.load({ device: "wasm" });
    phonemes = "xyz";
    const empty = await tts.generate("???");
    assert.equal(empty.samples.length, 0);
    assert.equal(empty.tokens, undefined);

    phonemes = "hI";
    omitDurations = true;
    plainArrayOutputs = true;
    const out = await tts.generate("Hi");
    assert.ok(out.samples instanceof Float32Array);
    assert.equal(out.durations?.length, 0);
  });

  test("omits the voice input for single-voice configs and swallows release errors", async () => {
    const { ParadeeTTS } = await loadEngine();
    const tts = await ParadeeTTS.fromBytes({ voices: ["af_heart"], vocab: CONFIG.vocab }, MODEL_BYTES, "wasm");
    assert.equal(tts.sampleRate, 24_000);
    await tts.generate("Hi.");
    assert.equal(runFeeds[0]!.voice, undefined);
    releaseFails = true;
    await tts.dispose();
  });
});
