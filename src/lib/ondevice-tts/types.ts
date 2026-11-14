/**
 * Shared types for on-device (browser) narration with Paradee-8M.
 *
 * Ported from huangyingting/neural-readalong (Apache-2.0), trimmed to the
 * English Paradee engine used by the Reader.
 */

export type RuntimeDevice = "webgpu" | "wasm";

export interface WordTokenSpan {
  firstTokenIndex: number;
  lastTokenIndex: number;
}

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

export type OnDeviceWorkerRequest =
  | {
      type: "synthesize";
      requestId: number;
      text: string;
      voice: string;
      speed: number;
    }
  | { type: "cancel"; requestId: number };

export type OnDeviceWorkerResponse =
  | { type: "loading"; requestId: number; progress: number }
  | { type: "ready"; requestId: number; device: RuntimeDevice }
  | { type: "chunk_count"; requestId: number; count: number }
  | {
      type: "chunk";
      requestId: number;
      samples: Float32Array;
      sampleRate: number;
      words: WordTimestamp[];
    }
  | { type: "complete"; requestId: number }
  | { type: "error"; requestId: number; phase: "load" | "generate"; error: string };
