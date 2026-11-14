/**
 * Dedicated worker that runs Paradee-8M synthesis off the main thread.
 *
 * The model loads once per worker (WebGPU when an adapter is available,
 * otherwise WASM) and stays warm across articles. Each `synthesize` request
 * streams sentence-sized chunks back with their samples and word timings; a
 * newer request or `cancel` supersedes the running one.
 */
import { ParadeeTTS } from "./paradee";
import { buildChunkAlignment, splitTextWithOffsets } from "./word-timestamps";
import type {
  ModelLoadProgress,
  OnDeviceWorkerRequest,
  OnDeviceWorkerResponse,
  RuntimeDevice,
} from "./types";

/** Sentence chunk ceiling; keeps each model call well under 510 phonemes. */
const MAX_CHUNK_CHARS = 200;

type WorkerScope = {
  postMessage(message: OnDeviceWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<OnDeviceWorkerRequest>) => void): void;
};

type GpuNavigator = { gpu?: { requestAdapter(): Promise<unknown | null> } };

const scope = self as unknown as WorkerScope;

let ttsPromise: Promise<ParadeeTTS> | null = null;
let activeRequestId = 0;

async function detectDevice(): Promise<RuntimeDevice> {
  const gpu = (navigator as unknown as GpuNavigator).gpu;
  if (!gpu) return "wasm";
  try {
    return (await gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

function loadTts(requestId: number): Promise<ParadeeTTS> {
  if (!ttsPromise) {
    const fileProgress = new Map<string, { loaded: number; total: number }>();
    const onProgress = (info: ModelLoadProgress) => {
      if (!info.file || !info.total) return;
      fileProgress.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
      let loaded = 0;
      let total = 0;
      for (const entry of fileProgress.values()) {
        loaded += entry.loaded;
        total += entry.total;
      }
      scope.postMessage({ type: "loading", requestId, progress: total > 0 ? (loaded / total) * 100 : 0 });
    };
    ttsPromise = detectDevice()
      .then((device) => ParadeeTTS.load({ device, progressCallback: onProgress }))
      .catch((err: unknown) => {
        ttsPromise = null;
        throw err;
      });
  }
  return ttsPromise;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

async function synthesize(request: Extract<OnDeviceWorkerRequest, { type: "synthesize" }>): Promise<void> {
  const { requestId, text, voice, speed } = request;
  const isCurrent = () => requestId === activeRequestId;

  let tts: ParadeeTTS;
  try {
    tts = await loadTts(requestId);
  } catch (err) {
    if (isCurrent()) {
      scope.postMessage({ type: "error", requestId, phase: "load", error: errorMessage(err, "Model load failed") });
    }
    return;
  }
  if (!isCurrent()) return;
  scope.postMessage({ type: "ready", requestId, device: tts.device });

  const spans = splitTextWithOffsets(text, MAX_CHUNK_CHARS);
  scope.postMessage({ type: "chunk_count", requestId, count: spans.length });

  let totalSamples = 0;
  let nextWordIndex = 0;
  try {
    for (let chunkIndex = 0; chunkIndex < spans.length; chunkIndex++) {
      if (!isCurrent()) return;
      const span = spans[chunkIndex]!;
      const generated = await tts.generate(span.text, { voice, speed });
      if (!isCurrent()) return;

      const alignment = buildChunkAlignment({
        chunkIndex,
        span,
        tokens: generated.tokens,
        durations: generated.durations,
        chunkSamples: generated.samples.length,
        totalSamplesBeforeChunk: totalSamples,
        sampleRate: generated.sampleRate,
        startingWordIndex: nextWordIndex,
      });
      totalSamples += generated.samples.length;
      nextWordIndex += alignment.words.length;

      scope.postMessage(
        {
          type: "chunk",
          requestId,
          samples: generated.samples,
          sampleRate: generated.sampleRate,
          words: alignment.words,
        },
        [generated.samples.buffer],
      );
    }
    if (isCurrent()) scope.postMessage({ type: "complete", requestId });
  } catch (err) {
    if (isCurrent()) {
      scope.postMessage({ type: "error", requestId, phase: "generate", error: errorMessage(err, "Synthesis failed") });
    }
  }
}

scope.addEventListener("message", (event) => {
  const message = event.data;
  if (!message) return;
  if (message.type === "cancel") {
    activeRequestId = Math.max(activeRequestId, message.requestId);
    return;
  }
  activeRequestId = message.requestId;
  void synthesize(message);
});
