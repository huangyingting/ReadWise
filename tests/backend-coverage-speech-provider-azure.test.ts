process.env.LOG_LEVEL = "error";

import { after, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const logger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
};

type SpeechMode =
  | "success"
  | "empty-audio"
  | "error-callback"
  | "constructor-throws"
  | "speak-throws"
  | "timeout";

let mode: SpeechMode;
let timeoutMs: number;
let closedCount: number;
let capturedConfig: Record<string, unknown> | null;
const originalSpeechTimeoutMs = process.env.SPEECH_TIMEOUT_MS;

before(() => {
  const SpeechSynthesisOutputFormat = {
    Audio16Khz32KBitRateMonoMp3: "16-32",
    Audio16Khz128KBitRateMonoMp3: "16-128",
    Audio24Khz48KBitRateMonoMp3: "24-48",
    Audio24Khz96KBitRateMonoMp3: "24-96",
    Audio48Khz96KBitRateMonoMp3: "48-96",
  };
  const SpeechSynthesisBoundaryType = { Word: "Word" };
  const ResultReason = { SynthesizingAudioCompleted: "completed" };

  class SpeechConfig {
    speechSynthesisVoiceName = "";
    speechSynthesisOutputFormat = "";

    static fromSubscription(key: string, region: string) {
      capturedConfig = { key, region };
      return new SpeechConfig();
    }
  }

  class SpeechSynthesizer {
    wordBoundary?: (sender: unknown, event: Record<string, unknown>) => void;

    constructor(config: SpeechConfig) {
      if (mode === "constructor-throws") {
        throw new Error("cannot construct");
      }
      capturedConfig = {
        ...(capturedConfig ?? {}),
        voice: config.speechSynthesisVoiceName,
        format: config.speechSynthesisOutputFormat,
      };
    }

    close() {
      closedCount++;
    }

    speakTextAsync(
      text: string,
      onSuccess: (result: { reason: string; audioData?: Uint8Array }) => void,
      onError: (message: string) => void,
    ) {
      if (mode === "timeout") return;
      if (mode === "speak-throws") throw new Error("speak failed");
      if (mode === "error-callback") {
        onError("provider failed");
        return;
      }

      this.wordBoundary?.(null, { boundaryType: "Punctuation" });
      this.wordBoundary?.(null, {
        boundaryType: SpeechSynthesisBoundaryType.Word,
        text: "world",
        audioOffset: 30_000,
        duration: 10_000,
        textOffset: 6,
        wordLength: 5,
      });
      this.wordBoundary?.(null, {
        boundaryType: SpeechSynthesisBoundaryType.Word,
        text: "   ",
        audioOffset: 10_000,
        duration: 20_000,
        textOffset: 0,
        wordLength: 5,
      });
      this.wordBoundary?.(null, {
        boundaryType: SpeechSynthesisBoundaryType.Word,
        text: "",
        audioOffset: 20_000,
        duration: 5_000,
        textOffset: -1,
        wordLength: 0,
      });

      onSuccess({
        reason: mode === "empty-audio" ? "canceled" : ResultReason.SynthesizingAudioCompleted,
        audioData: mode === "empty-audio" ? new Uint8Array() : new Uint8Array([1, 2, 3]),
      });
    }
  }

  mock.module("microsoft-cognitiveservices-speech-sdk", {
    namedExports: {
      ResultReason,
      SpeechConfig,
      SpeechSynthesizer,
      SpeechSynthesisBoundaryType,
      SpeechSynthesisOutputFormat,
    },
  });
  mock.module("@/lib/observability/logger", {
    namedExports: {
      createLogger: () => logger,
    },
  });
});

beforeEach(() => {
  mode = "success";
  timeoutMs = 100;
  process.env.SPEECH_TIMEOUT_MS = String(timeoutMs);
  closedCount = 0;
  capturedConfig = null;
});

after(() => {
  if (originalSpeechTimeoutMs === undefined) delete process.env.SPEECH_TIMEOUT_MS;
  else process.env.SPEECH_TIMEOUT_MS = originalSpeechTimeoutMs;
});

test("resolveMimeType maps supported and unknown formats to mp3 MIME", async () => {
  const { resolveMimeType } = await import("@/lib/speech/provider-azure");

  assert.equal(resolveMimeType("audio-16khz-32kbitrate-mono-mp3"), "audio/mpeg");
  assert.equal(resolveMimeType("audio-16khz-128kbitrate-mono-mp3"), "audio/mpeg");
  assert.equal(resolveMimeType("audio-24khz-48kbitrate-mono-mp3"), "audio/mpeg");
  assert.equal(resolveMimeType("audio-24khz-96kbitrate-mono-mp3"), "audio/mpeg");
  assert.equal(resolveMimeType("audio-48khz-96kbitrate-mono-mp3"), "audio/mpeg");
  assert.equal(resolveMimeType("unknown-format"), "audio/mpeg");
});

test("synthesize returns sorted audio timings and closes the synthesizer", async () => {
  const { synthesize } = await import("@/lib/speech/provider-azure");

  const result = await synthesize(
    "hello world",
    {
      key: "test-key",
      region: "eastus",
      voice: "en-US-TestNeural",
      format: "audio-16khz-32kbitrate-mono-mp3",
    },
    "article-1",
  );

  assert.equal(result?.provider, "azure");
  assert.equal(result?.audio.toString("hex"), "010203");
  assert.deepEqual(result?.words, [
    { word: "hello", startMs: 1, endMs: 3, textStart: 0, textEnd: 5 },
    { word: "world", startMs: 3, endMs: 4, textStart: 6, textEnd: 11 },
  ]);
  assert.equal(closedCount, 1);
  assert.deepEqual(capturedConfig, {
    key: "test-key",
    region: "eastus",
    voice: "en-US-TestNeural",
    format: "16-32",
  });
});

test("synthesize gracefully returns null for empty audio, callbacks, exceptions, and timeouts", async () => {
  const { synthesize } = await import("@/lib/speech/provider-azure");
  const config = {
    key: "test-key",
    region: "eastus",
    voice: "en-US-TestNeural",
    format: "unknown-format",
  };

  mode = "empty-audio";
  assert.equal(await synthesize("hello", config, "article-1"), null);
  assert.equal(closedCount, 1);

  mode = "error-callback";
  assert.equal(await synthesize("hello", config, "article-1"), null);
  assert.equal(closedCount, 2);

  mode = "speak-throws";
  assert.equal(await synthesize("hello", config, "article-1"), null);
  assert.equal(closedCount, 3);

  mode = "constructor-throws";
  assert.equal(await synthesize("hello", config, "article-1"), null);

  mode = "timeout";
  timeoutMs = 1;
  process.env.SPEECH_TIMEOUT_MS = String(timeoutMs);
  assert.equal(await synthesize("hello", config, "article-1"), null);
});
