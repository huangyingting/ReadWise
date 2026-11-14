/**
 * Shared types for on-device (browser) narration with Paradee-8M.
 *
 * Ported from huangyingting/neural-readalong (Apache-2.0), trimmed to the
 * English Paradee engine used by the Reader.
 */

export type RuntimeDevice = "webgpu" | "wasm";

export interface WordTimestamp {
  text: string;
  startMs: number;
  endMs: number;
  /** UTF-16 offsets into the full narration text. */
  charStart: number;
  charEnd: number;
  chunkIndex: number;
  wordIndex: number;
}

export interface ChunkAlignment {
  chunkIndex: number;
  text: string;
  charStart: number;
  charEnd: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  words: WordTimestamp[];
}

export interface TextChunkSpan {
  text: string;
  charStart: number;
  charEnd: number;
}

export interface TextSegment {
  type: "word" | "whitespace";
  text: string;
  charStart: number;
  charEnd: number;
  wordIndex?: number;
}

export interface ModelLoadProgress {
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface SynthesizeRequest {
  type: "synthesize";
  requestId: number;
  text: string;
  voice: string;
  speed: number;
}

export interface CancelRequest {
  type: "cancel";
  requestId: number;
}

export type OnDeviceWorkerRequest = SynthesizeRequest | CancelRequest;

export interface LoadingResponse {
  type: "loading";
  requestId: number;
  progress: number;
}

export interface ReadyResponse {
  type: "ready";
  requestId: number;
  device: RuntimeDevice;
}

export interface ChunkCountResponse {
  type: "chunk_count";
  requestId: number;
  count: number;
}

export interface ChunkResponse {
  type: "chunk";
  requestId: number;
  samples: Float32Array;
  sampleRate: number;
  words: WordTimestamp[];
}

export interface CompleteResponse {
  type: "complete";
  requestId: number;
}

export interface ErrorResponse {
  type: "error";
  requestId: number;
  phase: "load" | "generate";
  error: string;
}

export type OnDeviceWorkerResponse = LoadingResponse | ReadyResponse | ChunkCountResponse | ChunkResponse | CompleteResponse | ErrorResponse;
