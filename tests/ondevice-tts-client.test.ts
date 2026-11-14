/**
 * Main-thread on-device narration client: snapshot publishing policy,
 * request isolation, error and abort handling, and worker crash recovery.
 * The Web Worker is replaced by an in-process fake.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { OnDeviceWorkerRequest, OnDeviceWorkerResponse, WordTimestamp } from "@/lib/ondevice-tts/types";

type Listener = (event: { data: OnDeviceWorkerResponse }) => void;
type Responder = (message: OnDeviceWorkerRequest, worker: FakeWorker) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly url: string;
  readonly options: unknown;
  readonly posted: OnDeviceWorkerRequest[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Set<Listener | (() => void)>>();

  constructor(url: URL, options: unknown) {
    this.url = String(url);
    this.options = options;
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: Listener | (() => void)): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener | (() => void)): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: OnDeviceWorkerRequest): void {
    this.posted.push(message);
    queueMicrotask(() => responder(message, this));
  }

  emit(data: OnDeviceWorkerResponse): void {
    for (const listener of this.listeners.get("message") ?? []) (listener as Listener)({ data });
  }

  crash(): void {
    for (const listener of this.listeners.get("error") ?? []) (listener as () => void)();
  }

  terminate(): void {
    this.terminated = true;
  }
}

let responder: Responder = () => {};
const globals = globalThis as unknown as { Worker?: unknown; window?: unknown };

before(() => {
  globals.Worker = FakeWorker;
});

after(() => {
  delete globals.Worker;
  delete globals.window;
});

beforeEach(() => {
  responder = () => {};
});

function word(text: string, charStart: number, startMs: number): WordTimestamp {
  return { text, charStart, charEnd: charStart + text.length, startMs, endMs: startMs + 100, chunkIndex: 0, wordIndex: 0 };
}

function chunk(requestId: number, samples: number, words: WordTimestamp[] = []): OnDeviceWorkerResponse {
  return { type: "chunk", requestId, samples: new Float32Array(samples).fill(0.5), sampleRate: 10, words };
}

async function loadClient() {
  return import("@/lib/ondevice-tts/client");
}

describe("isOnDeviceTtsSupported", () => {
  test("requires a window with Worker and WebAssembly", async () => {
    const { isOnDeviceTtsSupported } = await loadClient();
    assert.equal(isOnDeviceTtsSupported(), false);
    globals.window = {};
    assert.equal(isOnDeviceTtsSupported(), true);
    delete globals.window;
  });
});

describe("synthesizeNarrationOnDevice", () => {
  test("publishes a first snapshot after 12 s, then on doubling, then the final audio", async () => {
    const { synthesizeNarrationOnDevice } = await loadClient();
    responder = (message, worker) => {
      if (message.type !== "synthesize") return;
      const id = message.requestId;
      worker.emit({ type: "loading", requestId: id, progress: 50 });
      worker.emit({ type: "ready", requestId: 999, device: "wasm" }); // other request: ignored
      worker.emit({ type: "ready", requestId: id, device: "webgpu" });
      worker.emit({ type: "chunk_count", requestId: id, count: 3 });
      worker.emit(chunk(id, 120, [word(`"Hello,`, 0, 0)])); // 12 s → first snapshot
      worker.emit(chunk(id, 60, [word("—", 8, 1200)])); // 18 s
      worker.emit(chunk(id, 60, [word("world.", 10, 1800)])); // 24 s → doubled
      worker.emit({ type: "complete", requestId: id });
    };

    const snapshots: Array<{ size: number; words: string[]; complete: boolean; device: string }> = [];
    const result = await synthesizeNarrationOnDevice("Hello, — world.", {
      voice: "bf_isabella",
      speed: 1.1,
      onSnapshot: (s) => snapshots.push({ size: s.audio.size, words: s.words.map((w) => w.word), complete: s.complete, device: s.device }),
    });

    assert.deepEqual(result, { device: "webgpu" });
    assert.deepEqual(snapshots, [
      { size: 44 + 120 * 2, words: ["Hello"], complete: false, device: "webgpu" },
      { size: 44 + 240 * 2, words: ["Hello", "world"], complete: false, device: "webgpu" },
      { size: 44 + 240 * 2, words: ["Hello", "world"], complete: true, device: "webgpu" },
    ]);
    const worker = FakeWorker.instances.at(-1)!;
    assert.match(worker.url, /paradee\.worker\.ts$/);
    assert.deepEqual(worker.options, { type: "module" });
    assert.deepEqual(worker.posted.at(-1), {
      type: "synthesize",
      requestId: (worker.posted.at(-1) as { requestId: number }).requestId,
      text: "Hello, — world.",
      voice: "bf_isabella",
      speed: 1.1,
    });
  });

  test("rejects when the worker produces no audio or reports an error", async () => {
    const { OnDeviceNarrationError, synthesizeNarrationOnDevice } = await loadClient();
    responder = (message, worker) => {
      if (message.type === "synthesize") worker.emit({ type: "complete", requestId: message.requestId });
    };
    await assert.rejects(
      () => synthesizeNarrationOnDevice("...", { onSnapshot: () => {} }),
      (err: unknown) => err instanceof OnDeviceNarrationError && err.phase === "generate" && /No speakable text/.test(err.message),
    );

    responder = (message, worker) => {
      if (message.type === "synthesize") {
        worker.emit({ type: "error", requestId: message.requestId, phase: "load", error: "model fetch failed" });
      }
    };
    await assert.rejects(
      () => synthesizeNarrationOnDevice("Hi", { onSnapshot: () => {} }),
      (err: unknown) => err instanceof OnDeviceNarrationError && err.phase === "load" && err.message === "model fetch failed",
    );
  });

  test("replaces a crashed worker", async () => {
    const { synthesizeNarrationOnDevice } = await loadClient();
    const before = FakeWorker.instances.length;
    responder = (message, worker) => {
      if (message.type === "synthesize") worker.crash();
    };
    await assert.rejects(() => synthesizeNarrationOnDevice("Hi", { onSnapshot: () => {} }), /worker failed/);
    assert.equal(FakeWorker.instances.at(-1)!.terminated, true);

    responder = (message, worker) => {
      if (message.type !== "synthesize") return;
      worker.emit(chunk(message.requestId, 5));
      worker.emit({ type: "complete", requestId: message.requestId });
    };
    const snapshots: boolean[] = [];
    await synthesizeNarrationOnDevice("Hi", { onSnapshot: (s) => snapshots.push(s.complete) });
    assert.deepEqual(snapshots, [true]);
    assert.equal(FakeWorker.instances.length, before + 1);
  });

  test("aborts before starting and cancels in-flight synthesis", async () => {
    const { synthesizeNarrationOnDevice } = await loadClient();
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      () => synthesizeNarrationOnDevice("Hi", { signal: aborted.signal, onSnapshot: () => {} }),
      { name: "AbortError" },
    );

    const controller = new AbortController();
    responder = (message) => {
      if (message.type === "synthesize") controller.abort();
    };
    await assert.rejects(
      () => synthesizeNarrationOnDevice("Hi", { signal: controller.signal, onSnapshot: () => {} }),
      { name: "AbortError" },
    );
    const posted = FakeWorker.instances.at(-1)!.posted;
    const last = posted.at(-1)!;
    assert.equal(last.type, "cancel");
    assert.equal(last.requestId, posted.at(-2)!.requestId);
  });
});
