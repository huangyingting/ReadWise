/**
 * Main-thread client for on-device narration.
 *
 * Owns one long-lived worker (the model stays warm across articles) and turns
 * its streamed chunks into progressively longer WAV snapshots: the first once
 * a few seconds of speech exist, then each time the generated audio doubles,
 * then the final full-length audio. The Reader swaps snapshots into its single
 * `<audio>` element while preserving the playback position.
 */
import type { SpeechWord } from "@/lib/speech/timing";
import { encodeWav, floatToPcm16, toSpeechWords } from "./narration";
import { DEFAULT_PARADEE_VOICE } from "./voices";
import type { OnDeviceWorkerRequest, OnDeviceWorkerResponse, RuntimeDevice } from "./types";

/** Seconds of generated speech before the first playable snapshot. */
const FIRST_SNAPSHOT_SECONDS = 12;

export type OnDeviceNarrationSnapshot = {
  audio: Blob;
  words: SpeechWord[];
  /** True for the final, full-length snapshot. */
  complete: boolean;
  device: RuntimeDevice;
};

export type OnDeviceNarrationOptions = {
  voice?: string;
  speed?: number;
  signal?: AbortSignal;
  onSnapshot: (snapshot: OnDeviceNarrationSnapshot) => void;
};

export class OnDeviceNarrationError extends Error {
  constructor(
    message: string,
    readonly phase: "load" | "generate",
  ) {
    super(message);
    this.name = "OnDeviceNarrationError";
  }
}

let worker: Worker | null = null;
let nextRequestId = 0;

/** Web Workers + WebAssembly are the minimum; WebGPU is optional. */
export function isOnDeviceTtsSupported(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly === "object";
}

function getWorker(): Worker {
  worker ??= new Worker(new URL("./paradee.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

/**
 * Synthesizes `text` on device. Resolves after the final snapshot; rejects
 * with `OnDeviceNarrationError` on model-load or synthesis failure, or with
 * an `AbortError` when `signal` aborts.
 */
export function synthesizeNarrationOnDevice(
  text: string,
  { voice = DEFAULT_PARADEE_VOICE, speed = 1, signal, onSnapshot }: OnDeviceNarrationOptions,
): Promise<{ device: RuntimeDevice }> {
  const ttsWorker = getWorker();
  const requestId = ++nextRequestId;

  return new Promise((resolve, reject) => {
    const pcmChunks: Int16Array[] = [];
    const words: SpeechWord[] = [];
    let sampleRate = 24_000;
    let totalSamples = 0;
    let publishedSamples = 0;
    let device: RuntimeDevice = "wasm";

    const cleanup = () => {
      ttsWorker.removeEventListener("message", onMessage);
      ttsWorker.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };

    const publish = (complete: boolean) => {
      publishedSamples = totalSamples;
      onSnapshot({ audio: encodeWav(pcmChunks, sampleRate), words: [...words], complete, device });
    };

    const shouldPublish = () =>
      publishedSamples === 0
        ? totalSamples >= FIRST_SNAPSHOT_SECONDS * sampleRate
        : totalSamples >= publishedSamples * 2;

    function onMessage(event: MessageEvent<OnDeviceWorkerResponse>) {
      const message = event.data;
      if (message.requestId !== requestId) return;
      switch (message.type) {
        case "ready":
          device = message.device;
          break;
        case "chunk":
          sampleRate = message.sampleRate;
          pcmChunks.push(floatToPcm16(message.samples));
          totalSamples += message.samples.length;
          words.push(...toSpeechWords(message.words));
          if (shouldPublish()) publish(false);
          break;
        case "complete":
          cleanup();
          if (totalSamples === 0) {
            reject(new OnDeviceNarrationError("No speakable text", "generate"));
            return;
          }
          publish(true);
          resolve({ device });
          break;
        case "error":
          cleanup();
          reject(new OnDeviceNarrationError(message.error, message.phase));
          break;
        default:
          break;
      }
    }

    function onError() {
      cleanup();
      // A crashed worker cannot be reused.
      worker?.terminate();
      worker = null;
      reject(new OnDeviceNarrationError("On-device narration worker failed", "load"));
    }

    function onAbort() {
      cleanup();
      ttsWorker.postMessage({ type: "cancel", requestId } satisfies OnDeviceWorkerRequest);
      reject(new DOMException("On-device narration aborted", "AbortError"));
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }
    ttsWorker.addEventListener("message", onMessage);
    ttsWorker.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    ttsWorker.postMessage({ type: "synthesize", requestId, text, voice, speed } satisfies OnDeviceWorkerRequest);
  });
}
