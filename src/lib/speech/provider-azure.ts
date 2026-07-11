/**
 * Azure Speech synthesis provider (server-only).
 *
 * This is the ONLY module that imports `microsoft-cognitiveservices-speech-sdk`.
 * All Azure SDK surface is confined here to prevent accidental browser-bundle
 * inclusion and to give synthesis a single well-defined seam.
 */

import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import {
  speechTimeoutMs,
  type SpeechConfig as AzureSpeechConfig,
} from "@/lib/runtime-config/speech";
import { createLogger } from "@/lib/observability/logger";
import type { SpeechWord } from "./timing";

const log = createLogger("speech");

const DEFAULT_OUTPUT_FORMAT = {
  enum: sdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3,
  mimeType: "audio/mpeg",
} as const;

const OUTPUT_FORMATS: Record<
  string,
  { enum: sdk.SpeechSynthesisOutputFormat; mimeType: string }
> = {
  "audio-16khz-32kbitrate-mono-mp3": {
    enum: sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3,
    mimeType: "audio/mpeg",
  },
  "audio-16khz-128kbitrate-mono-mp3": {
    enum: sdk.SpeechSynthesisOutputFormat.Audio16Khz128KBitRateMonoMp3,
    mimeType: "audio/mpeg",
  },
  "audio-24khz-48kbitrate-mono-mp3": {
    enum: sdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3,
    mimeType: "audio/mpeg",
  },
  "audio-24khz-96kbitrate-mono-mp3": {
    enum: sdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3,
    mimeType: "audio/mpeg",
  },
  "audio-48khz-96kbitrate-mono-mp3": {
    enum: sdk.SpeechSynthesisOutputFormat.Audio48Khz96KBitRateMonoMp3,
    mimeType: "audio/mpeg",
  },
};

type AzureWordBoundaryEvent = {
  boundaryType: sdk.SpeechSynthesisBoundaryType;
  text?: unknown;
  textOffset: number;
  wordLength: number;
  audioOffset: number;
  duration: number;
};

export type SynthesisOutput = {
  audio: Buffer;
  provider: "azure";
  words: SpeechWord[];
};

/** Ticks (100-nanosecond units) to milliseconds. */
function ticksToMilliseconds(ticks: number): number {
  return ticks / 1e4;
}

/** Maps the configured output-format string to an SDK enum + MIME type. */
function resolveOutputFormat(format: string): {
  enum: sdk.SpeechSynthesisOutputFormat;
  mimeType: string;
} {
  return OUTPUT_FORMATS[format] ?? DEFAULT_OUTPUT_FORMAT;
}

/**
 * Returns the MIME type for the given output-format string.
 * Safe to call from outside the provider without touching the SDK.
 */
export function resolveMimeType(format: string): string {
  return resolveOutputFormat(format).mimeType;
}

function resolveBoundaryWord(text: string, event: AzureWordBoundaryEvent): string {
  return typeof event.text === "string" && event.text.trim()
    ? event.text
    : text.slice(event.textOffset, event.textOffset + event.wordLength);
}

function hasValidTextSpan(event: AzureWordBoundaryEvent): boolean {
  return (
    Number.isFinite(event.textOffset) &&
    Number.isFinite(event.wordLength) &&
    event.textOffset >= 0 &&
    event.wordLength > 0
  );
}

function wordTimingFromBoundary(text: string, event: AzureWordBoundaryEvent): SpeechWord | null {
  if (event.boundaryType !== sdk.SpeechSynthesisBoundaryType.Word) {
    return null;
  }

  const word = resolveBoundaryWord(text, event);
  if (!word.trim()) return null;

  const startMs = ticksToMilliseconds(event.audioOffset);
  const durationMs = ticksToMilliseconds(event.duration);
  const timing: SpeechWord = {
    word,
    startMs,
    endMs: startMs + durationMs,
  };

  if (hasValidTextSpan(event)) {
    timing.textStart = event.textOffset;
    timing.textEnd = event.textOffset + event.wordLength;
  }

  return timing;
}

/**
 * Synthesizes `text` via Azure Speech, collecting word-boundary timings.
 * Resolves null on any failure so callers can degrade gracefully.
 * Includes a configurable timeout (SPEECH_TIMEOUT_MS) to prevent hangs.
 *
 * Resource ownership: a single `settled` flag gates all resolve/close paths.
 * Whichever branch (success, error, timeout) wins sets `settled = true`,
 * closes the synthesizer exactly once, and cancels any live timer. Late
 * callbacks after settlement perform idempotent cleanup only.
 */
export function synthesize(
  text: string,
  config: AzureSpeechConfig,
  articleId: string,
): Promise<SynthesisOutput | null> {
  const start = Date.now();
  const synthesizeTimeoutMs = speechTimeoutMs();
  log.info("speech.synthesis_start", { articleId, textLength: text.length });

  return new Promise<SynthesisOutput | null>((resolve) => {
    let settled = false;
    let synthesizer: sdk.SpeechSynthesizer | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function settle(result: SynthesisOutput | null): void {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      resolve(result);
    }

    function closeSynthesizer(): void {
      if (synthesizer !== null) {
        synthesizer.close();
        synthesizer = null;
      }
    }

    try {
      const speechConfig = sdk.SpeechConfig.fromSubscription(
        config.key,
        config.region,
      );
      speechConfig.speechSynthesisVoiceName = config.voice;
      speechConfig.speechSynthesisOutputFormat = resolveOutputFormat(
        config.format,
      ).enum;

      synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

      const words: SpeechWord[] = [];
      synthesizer.wordBoundary = (_s, e) => {
        if (settled) return;
        const timing = wordTimingFromBoundary(text, e as AzureWordBoundaryEvent);
        if (timing) words.push(timing);
      };

      timer = setTimeout(() => {
        timer = null;
        if (settled) return;
        log.error("speech.synthesis_failure", {
          articleId,
          reason: "timeout",
          timeoutMs: synthesizeTimeoutMs,
          durationMs: Date.now() - start,
        });
        closeSynthesizer();
        settle(null);
      }, synthesizeTimeoutMs);

      synthesizer.speakTextAsync(
        text,
        (result) => {
          if (settled) {
            closeSynthesizer();
            return;
          }
          const ok =
            result.reason === sdk.ResultReason.SynthesizingAudioCompleted;
          const audioData = result.audioData;
          closeSynthesizer();
          if (ok && audioData && audioData.byteLength > 0) {
            words.sort((a, b) => a.startMs - b.startMs);
            log.info("speech.synthesis_success", {
              articleId,
              durationMs: Date.now() - start,
              audioBytes: audioData.byteLength,
              wordCount: words.length,
            });
            settle({ audio: Buffer.from(audioData), provider: "azure", words });
          } else {
            log.warn("speech.synthesis_failure", {
              articleId,
              reason: "incomplete_or_empty_audio",
              resultReason: result.reason,
              durationMs: Date.now() - start,
            });
            settle(null);
          }
        },
        (errorMessage) => {
          if (settled) {
            closeSynthesizer();
            return;
          }
          closeSynthesizer();
          log.error("speech.synthesis_failure", {
            articleId,
            reason: "error_callback",
            error: String(errorMessage),
            durationMs: Date.now() - start,
          });
          settle(null);
        },
      );
    } catch (err) {
      closeSynthesizer();
      log.error("speech.synthesis_failure", {
        articleId,
        reason: "exception",
        error: String(err),
        durationMs: Date.now() - start,
      });
      settle(null);
    }
  });
}
