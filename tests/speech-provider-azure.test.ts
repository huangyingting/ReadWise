process.env.LOG_LEVEL = "error";

import { after, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const logCalls: { level: string; msg: string; meta: Record<string, unknown> }[] = [];
const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => { logCalls.push({ level: "debug", msg, meta: meta ?? {} }); },
  error: (msg: string, meta?: Record<string, unknown>) => { logCalls.push({ level: "error", msg, meta: meta ?? {} }); },
  info: (msg: string, meta?: Record<string, unknown>) => { logCalls.push({ level: "info", msg, meta: meta ?? {} }); },
  warn: (msg: string, meta?: Record<string, unknown>) => { logCalls.push({ level: "warn", msg, meta: meta ?? {} }); },
};

type SpeechMode =
  | "success"
  | "empty-audio"
  | "error-callback"
  | "constructor-throws"
  | "speak-throws"
  | "timeout"
  | "deferred";

let mode: SpeechMode;
let timeoutMs: number;
let closedCount: number;
let capturedConfig: Record<string, unknown> | null;

/** Stored callbacks for deferred mode — allows testing late callback after timeout. */
let deferredOnSuccess: ((result: { reason: string; audioData?: Uint8Array }) => void) | null;
let deferredOnError: ((message: string) => void) | null;

const originalSpeechTimeoutMs = process.env.SPEECH_TIMEOUT_MS;
const AZURE_CONFIG = {
  key: "test-key",
  region: "eastus",
  voice: "en-US-TestNeural",
  format: "audio-16khz-32kbitrate-mono-mp3",
};

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
      if (mode === "deferred") {
        deferredOnSuccess = onSuccess;
        deferredOnError = onError;
        return;
      }
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
  deferredOnSuccess = null;
  deferredOnError = null;
  logCalls.length = 0;
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
    AZURE_CONFIG,
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
  const unknownFormatConfig = { ...AZURE_CONFIG, format: "unknown-format" };
  const expectNullForMode = async (nextMode: SpeechMode, expectedClosedCount?: number) => {
    mode = nextMode;
    assert.equal(await synthesize("hello", unknownFormatConfig, "article-1"), null);
    if (expectedClosedCount !== undefined) assert.equal(closedCount, expectedClosedCount);
  };

  await expectNullForMode("empty-audio", 1);
  await expectNullForMode("error-callback", 2);
  await expectNullForMode("speak-throws", 3);
  await expectNullForMode("constructor-throws");

  timeoutMs = 1;
  process.env.SPEECH_TIMEOUT_MS = String(timeoutMs);
  await expectNullForMode("timeout");
});

test("timeout closes the synthesizer exactly once", async () => {
  const { synthesize } = await import("@/lib/speech/provider-azure");

  mode = "timeout";
  timeoutMs = 5;
  process.env.SPEECH_TIMEOUT_MS = String(timeoutMs);
  closedCount = 0;

  const result = await synthesize("hello", AZURE_CONFIG, "article-timeout");

  assert.equal(result, null);
  assert.equal(closedCount, 1, "timeout must close synthesizer exactly once");
  const timeoutLog = logCalls.find(
    (l) => l.level === "error" && l.meta.reason === "timeout",
  );
  assert.ok(timeoutLog, "timeout should log an error with reason=timeout");
});

test("success cancels timeout timer — no timeout log emitted", async () => {
  const { synthesize } = await import("@/lib/speech/provider-azure");

  mode = "success";
  timeoutMs = 50;
  process.env.SPEECH_TIMEOUT_MS = String(timeoutMs);
  logCalls.length = 0;

  const result = await synthesize("hello world", AZURE_CONFIG, "article-fast");

  assert.ok(result, "should succeed");
  assert.equal(closedCount, 1);

  // Wait beyond what would be the timeout period to confirm no timeout log fires
  await new Promise((r) => setTimeout(r, 80));

  const timeoutLog = logCalls.find(
    (l) => l.level === "error" && l.meta.reason === "timeout",
  );
  assert.equal(timeoutLog, undefined, "no timeout log should fire after success");
});

test("late success callback after timeout cannot change result or double-close", async () => {
  const { synthesize } = await import("@/lib/speech/provider-azure");

  mode = "deferred";
  timeoutMs = 5;
  process.env.SPEECH_TIMEOUT_MS = String(timeoutMs);
  closedCount = 0;

  const resultPromise = synthesize("hello world", AZURE_CONFIG, "article-late");

  // Wait for timeout to fire
  const result = await resultPromise;
  assert.equal(result, null, "should resolve null from timeout");
  assert.equal(closedCount, 1, "timeout closes synthesizer once");

  // Now invoke the late success callback (simulating SDK calling back after timeout)
  assert.ok(deferredOnSuccess, "deferred success callback should be stored");
  deferredOnSuccess!({ reason: "completed", audioData: new Uint8Array([9, 9, 9]) });

  // Still null — no result change; close is idempotent (synthesizer already null)
  assert.equal(closedCount, 1, "late callback must not double-close");
});

test("late error callback after timeout cannot change result or double-close", async () => {
  const { synthesize } = await import("@/lib/speech/provider-azure");

  mode = "deferred";
  timeoutMs = 5;
  process.env.SPEECH_TIMEOUT_MS = String(timeoutMs);
  closedCount = 0;

  const result = await synthesize("hello world", AZURE_CONFIG, "article-late-err");
  assert.equal(result, null);
  assert.equal(closedCount, 1, "timeout closes synthesizer once");

  // Invoke late error callback
  assert.ok(deferredOnError, "deferred error callback should be stored");
  deferredOnError!("belated failure");

  assert.equal(closedCount, 1, "late error callback must not double-close");
});

test("constructor failure does not leak a timer", async () => {
  const { synthesize } = await import("@/lib/speech/provider-azure");

  mode = "constructor-throws";
  timeoutMs = 5;
  process.env.SPEECH_TIMEOUT_MS = String(timeoutMs);
  logCalls.length = 0;

  const result = await synthesize("hello", AZURE_CONFIG, "article-ctor");
  assert.equal(result, null);

  // Wait beyond timeout period — no timeout log should fire
  await new Promise((r) => setTimeout(r, 20));

  const timeoutLog = logCalls.find(
    (l) => l.level === "error" && l.meta.reason === "timeout",
  );
  assert.equal(timeoutLog, undefined, "constructor failure must cancel the timer");
});
