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
import type { SpeechWord } from "@/lib/speech-timing";

const log = createLogger("speech");

export type SynthesisOutput = {
  audio: Buffer;
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
  const map: Record<
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
  return (
    map[format] ?? {
      enum: sdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3,
      mimeType: "audio/mpeg",
    }
  );
}

/**
 * Returns the MIME type for the given output-format string.
 * Safe to call from outside the provider without touching the SDK.
 */
export function resolveMimeType(format: string): string {
  return resolveOutputFormat(format).mimeType;
}

/**
 * Synthesizes `text` via Azure Speech, collecting word-boundary timings.
 * Resolves null on any failure so callers can degrade gracefully.
 * Includes a configurable timeout (SPEECH_TIMEOUT_MS) to prevent hangs.
 */
export function synthesize(
  text: string,
  config: AzureSpeechConfig,
  articleId: string,
): Promise<SynthesisOutput | null> {
  const start = Date.now();
  const synthesizeTimeoutMs = speechTimeoutMs();
  log.info("speech.synthesis_start", { articleId, textLength: text.length });

  const inner = new Promise<SynthesisOutput | null>((resolve) => {
    let synthesizer: sdk.SpeechSynthesizer | null = null;
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
        if (e.boundaryType !== sdk.SpeechSynthesisBoundaryType.Word) {
          return;
        }
        const eventText = (e as { text?: unknown }).text;
        const word =
          typeof eventText === "string" && eventText.trim()
            ? eventText
            : text.slice(e.textOffset, e.textOffset + e.wordLength);
        if (!word.trim()) return;
        words.push({
          word,
          offset: ticksToMilliseconds(e.audioOffset),
          duration: ticksToMilliseconds(e.duration),
        });
      };

      synthesizer.speakTextAsync(
        text,
        (result) => {
          const ok =
            result.reason === sdk.ResultReason.SynthesizingAudioCompleted;
          const audioData = result.audioData;
          synthesizer?.close();
          synthesizer = null;
          if (ok && audioData && audioData.byteLength > 0) {
            words.sort((a, b) => a.offset - b.offset);
            log.info("speech.synthesis_success", {
              articleId,
              durationMs: Date.now() - start,
              audioBytes: audioData.byteLength,
              wordCount: words.length,
            });
            resolve({ audio: Buffer.from(audioData), words });
          } else {
            log.warn("speech.synthesis_failure", {
              articleId,
              reason: "incomplete_or_empty_audio",
              resultReason: result.reason,
              durationMs: Date.now() - start,
            });
            resolve(null);
          }
        },
        (errorMessage) => {
          synthesizer?.close();
          synthesizer = null;
          log.error("speech.synthesis_failure", {
            articleId,
            reason: "error_callback",
            error: String(errorMessage),
            durationMs: Date.now() - start,
          });
          resolve(null);
        },
      );
    } catch (err) {
      synthesizer?.close();
      log.error("speech.synthesis_failure", {
        articleId,
        reason: "exception",
        error: String(err),
        durationMs: Date.now() - start,
      });
      resolve(null);
    }
  });

  const timeout = new Promise<SynthesisOutput | null>((resolve) => {
    const timer = setTimeout(() => {
      log.error("speech.synthesis_failure", {
        articleId,
        reason: "timeout",
        timeoutMs: synthesizeTimeoutMs,
        durationMs: Date.now() - start,
      });
      resolve(null);
    }, synthesizeTimeoutMs);
    inner.then(() => clearTimeout(timer)).catch(() => clearTimeout(timer));
  });

  return Promise.race([inner, timeout]);
}
