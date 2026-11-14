/**
 * On-device narration worker: WebGPU detection, model-load progress and
 * retry, chunked synthesis messages, request superseding, cancellation, and
 * error reporting. The Paradee engine is mocked; alignment is real.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import type { OnDeviceWorkerRequest, OnDeviceWorkerResponse } from "@/lib/ondevice-tts/types";

type GpuMode = "none" | "null-adapter" | "throws" | "adapter";

let listener: ((event: { data: OnDeviceWorkerRequest | null }) => void) | null = null;
let posted: OnDeviceWorkerResponse[] = [];
let transfers: unknown[][] = [];
let gpuMode: GpuMode = "none";
let loadDevices: string[] = [];
let loadFails = false;
let generateFails = false;
let generateGate: Promise<void> | null = null;

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

before(() => {
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: {
      postMessage: (message: OnDeviceWorkerResponse, transfer?: unknown[]) => {
        posted.push(message);
        transfers.push(transfer ?? []);
      },
      addEventListener: (_type: string, fn: typeof listener) => {
        listener = fn;
      },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    get: () =>
      gpuMode === "none"
        ? {}
        : {
            gpu: {
              requestAdapter: async () => {
                if (gpuMode === "throws") throw new Error("gpu lost");
                return gpuMode === "adapter" ? {} : null;
              },
            },
          },
  });

  mock.module("@/lib/ondevice-tts/paradee", {
    namedExports: {
      ParadeeTTS: {
        load: async ({ device, progressCallback }: { device: string; progressCallback: (info: object) => void }) => {
          loadDevices.push(device);
          progressCallback({ file: "config.json", loaded: 1, total: 2 });
          progressCallback({ progress: 50 }); // no file/total: ignored
          progressCallback({ file: "model.onnx", loaded: 3, total: 6 });
          if (loadFails) throw new Error("model fetch failed");
          return {
            device,
            generate: async (text: string) => {
              if (generateGate) await generateGate;
              if (generateFails) throw new Error("synthesis exploded");
              const phonemes = Array.from(text.replace(/[^a-z ]/gi, "").toLowerCase());
              return {
                samples: new Float32Array(10 * (phonemes.length + 2)),
                sampleRate: 10,
                tokens: ["$", ...phonemes, "$"],
                durations: new Float32Array(phonemes.length + 2).fill(1),
              };
            },
          };
        },
      },
    },
  });
});

after(() => {
  delete (globalThis as { self?: unknown }).self;
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
});

beforeEach(() => {
  posted = [];
  transfers = [];
  loadFails = false;
  generateFails = false;
  generateGate = null;
});

let nextId = 0;

async function send(message: OnDeviceWorkerRequest | null): Promise<void> {
  if (!listener) await import("@/lib/ondevice-tts/paradee.worker");
  listener!({ data: message });
}

async function synthesize(text: string): Promise<number> {
  const requestId = ++nextId;
  await send({ type: "synthesize", requestId, text, voice: "af_heart", speed: 1 });
  return requestId;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

const ofRequest = (id: number) => posted.filter((m) => m.requestId === id);

test("reports model-load failures and retries the load on the next request", async () => {
  gpuMode = "throws";
  loadFails = true;
  const failed = await synthesize("Hello there.");
  await settle();
  assert.deepEqual(
    ofRequest(failed).map((m) => m.type),
    ["loading", "loading", "error"],
  );
  assert.deepEqual(ofRequest(failed).at(-1), { type: "error", requestId: failed, phase: "load", error: "model fetch failed" });
  assert.deepEqual(
    ofRequest(failed).filter((m) => m.type === "loading").map((m) => (m as { progress: number }).progress),
    [50, 50],
  );

  gpuMode = "null-adapter";
  await synthesize("Again.");
  await settle();
  gpuMode = "adapter";
  loadFails = false;
  await synthesize("Once more.");
  await settle();
  assert.deepEqual(loadDevices, ["wasm", "wasm", "webgpu"]);
});

test("streams chunk audio and words, then completes; the model stays loaded", async () => {
  const id = await synthesize("Hello there. General Kenobi!");
  await settle();
  const messages = ofRequest(id);
  assert.deepEqual(messages.map((m) => m.type), ["ready", "chunk_count", "chunk", "chunk", "complete"]);
  assert.deepEqual(messages[0], { type: "ready", requestId: id, device: "webgpu" });
  assert.deepEqual(messages[1], { type: "chunk_count", requestId: id, count: 2 });
  const chunks = messages.filter((m): m is Extract<OnDeviceWorkerResponse, { type: "chunk" }> => m.type === "chunk");
  assert.deepEqual(chunks.flatMap((c) => c.words.map((w) => [w.text, w.charStart, w.wordIndex])), [
    ["Hello", 0, 0],
    ["there.", 6, 1],
    ["General", 13, 2],
    ["Kenobi!", 21, 3],
  ]);
  assert.ok(chunks[1]!.words[0]!.startMs >= chunks[0]!.words.at(-1)!.endMs);
  assert.equal(transfers.filter((t) => t.length === 1).length, 2, "sample buffers are transferred");
  assert.deepEqual(loadDevices, ["wasm", "wasm", "webgpu"], "no reload");
});

test("reports generation failures", async () => {
  generateFails = true;
  const id = await synthesize("Hello.");
  await settle();
  assert.deepEqual(ofRequest(id).at(-1), { type: "error", requestId: id, phase: "generate", error: "synthesis exploded" });
});

test("a newer request or a cancel supersedes the running one", async () => {
  let release!: () => void;
  generateGate = new Promise((resolve) => (release = resolve));
  const first = await synthesize("One. Two.");
  await settle();
  const second = await synthesize("Three.");
  await send({ type: "cancel", requestId: first }); // stale cancel does not stop the newer request
  await send(null); // ignored
  release();
  await settle();
  assert.deepEqual(ofRequest(first).map((m) => m.type), ["ready", "chunk_count"]);
  assert.deepEqual(ofRequest(second).map((m) => m.type), ["ready", "chunk_count", "chunk", "complete"]);

  generateGate = new Promise((resolve) => (release = resolve));
  const third = await synthesize("Four. Five.");
  await settle();
  await send({ type: "cancel", requestId: third });
  release();
  await settle();
  assert.deepEqual(ofRequest(third).map((m) => m.type), ["ready", "chunk_count"]);

  // A request superseded before the (cached) model resolves never reports ready.
  const fourth = ++nextId;
  const fifth = ++nextId;
  listener!({ data: { type: "synthesize", requestId: fourth, text: "Six.", voice: "af_heart", speed: 1 } });
  listener!({ data: { type: "synthesize", requestId: fifth, text: "Seven.", voice: "af_heart", speed: 1 } });
  await settle();
  assert.deepEqual(ofRequest(fourth), []);
  assert.deepEqual(ofRequest(fifth).map((m) => m.type), ["ready", "chunk_count", "chunk", "complete"]);
});

test("cancelling during generation drops failures from the stale request", async () => {
  let release!: () => void;
  generateGate = new Promise((resolve) => (release = resolve));
  generateFails = true;
  const id = await synthesize("Hello.");
  await settle();
  await send({ type: "cancel", requestId: id });
  release();
  await settle();
  assert.deepEqual(ofRequest(id).map((m) => m.type), ["ready", "chunk_count"]);
});
