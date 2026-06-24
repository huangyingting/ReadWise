import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { htmlToPlainText } from "@/lib/translation";
import {
  DEFAULT_SPEECH_VOICE,
  speechConfig,
  speechTimeoutMs,
  type SpeechConfig as AzureSpeechConfig,
} from "@/lib/config";
import { createLogger } from "@/lib/logger";
import { getMediaStorage } from "@/lib/storage";
import {
  timingEndSeconds,
  type SpeechWord,
} from "@/lib/speech-timing";
import {
  getAiProcessableArticleById,
  isArticleOperator,
  SYSTEM_ARTICLE_CONTEXT,
  type ArticleAccessContext,
} from "@/lib/article-access";

const log = createLogger("speech");

/** Max characters of article text synthesized (bounds audio size / latency). */
const MAX_TTS_CHARS = 5000;

export type { SpeechWord } from "@/lib/speech-timing";

export type SpeechResult = {
  audio: string | null;
  mimeType: string | null;
  plainText: string;
  words: SpeechWord[];
  voice: string;
  cached: boolean;
  fallback: boolean;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Parses stored word timings from Prisma Json fields. */
export function parseStoredSpeechWords(
  raw: Prisma.JsonValue | null | undefined,
): SpeechWord[] | null {
  if (raw == null) {
    return null;
  }

  if (!Array.isArray(raw)) {
    return null;
  }

  const words: SpeechWord[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const record = item as Record<string, unknown>;
    const { word, offset, duration } = record;
    if (
      typeof word !== "string" ||
      !word.trim() ||
      !finiteNumber(offset) ||
      !finiteNumber(duration) ||
      offset < 0 ||
      duration < 0
    ) {
      return null;
    }
    words.push({ word, offset, duration });
  }

  return words.sort((a, b) => a.offset - b.offset);
}

function readSpeechConfig(): AzureSpeechConfig | null {
  return speechConfig.get();
}

/** Whether Azure Speech credentials are configured. */
export function isSpeechConfigured(): boolean {
  return speechConfig.isConfigured();
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

/** Ticks (100-nanosecond units) to milliseconds. */
function ticksToMilliseconds(ticks: number): number {
  return ticks / 1e4;
}

type SynthesisOutput = {
  audio: Buffer;
  words: SpeechWord[];
};

/**
 * Synthesizes `text` via Azure Speech, collecting word-boundary timings.
 * Resolves null on any failure so callers can degrade gracefully.
 * Includes a configurable timeout (SPEECH_TIMEOUT_MS) to prevent hangs.
 */
function synthesize(
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
            result.reason ===
            sdk.ResultReason.SynthesizingAudioCompleted;
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

function fallbackResult(voice: string): SpeechResult {
  return {
    audio: null,
    mimeType: null,
    plainText: "",
    words: [],
    voice,
    cached: false,
    fallback: true,
  };
}

/** Largest word end timing (seconds) — used as the audio duration. */
function lastWordEnd(words: SpeechWord[]): number | undefined {
  let max = 0;
  for (const w of words) {
    const end = timingEndSeconds(w);
    if (end > max) max = end;
  }
  return max > 0 ? max : undefined;
}

/**
 * Resolves a playable `data:` URL for a stored speech row regardless of where
 * the audio lives. Prefers the legacy base64 column; otherwise reads the bytes
 * back from object storage via the configured backend. Returns null when the
 * audio cannot be located (e.g. storage unconfigured after a migration).
 */
async function resolveStoredAudioUrl(row: {
  mimeType: string;
  audioBase64: string | null;
  storageKey: string | null;
}): Promise<string | null> {
  if (row.audioBase64) {
    return `data:${row.mimeType};base64,${row.audioBase64}`;
  }
  if (row.storageKey) {
    const storage = getMediaStorage();
    if (!storage) return null;
    const bytes = await storage.get(row.storageKey);
    if (!bytes) return null;
    return `data:${row.mimeType};base64,${bytes.toString("base64")}`;
  }
  return null;
}

/**
 * Returns cached narration audio + word timings for an article, generating and
 * caching them via Azure Speech on a cache miss. Degrades gracefully (no cache)
 * when credentials are absent or synthesis fails.
 */
export async function getOrCreateArticleSpeech(
  articleId: string,
  context: ArticleAccessContext | null = SYSTEM_ARTICLE_CONTEXT,
): Promise<SpeechResult | null> {
  const allowedArticle = !isArticleOperator(context)
    ? await getAiProcessableArticleById(articleId, context, {
        select: { title: true, content: true },
      })
    : null;
  if (!isArticleOperator(context) && !allowedArticle) {
    return null;
  }

  const cached = await prisma.articleSpeech.findUnique({
    where: { articleId },
  });
  if (cached) {
    const words = parseStoredSpeechWords(cached.words);
    if (!words) {
      log.error("speech.cache_parse_failure", {
        articleId,
        error: "Malformed cached word timings",
      });
      // Treat the corrupt row as a cache miss — fall through to regenerate.
      await prisma.articleSpeech.delete({ where: { articleId } });
      return getOrCreateArticleSpeech(articleId, context);
    }
    return {
      audio: await resolveStoredAudioUrl(cached),
      mimeType: cached.mimeType,
      plainText: cached.plainText,
      words,
      voice: cached.voice,
      cached: true,
      fallback: false,
    };
  }

  const article =
    allowedArticle ??
    (await prisma.article.findUnique({
      where: { id: articleId },
      select: { title: true, content: true },
    }));
  if (!article) {
    return null;
  }

  const config = readSpeechConfig();
  if (!config) {
    return fallbackResult(DEFAULT_SPEECH_VOICE);
  }

  const plainText = htmlToPlainText(article.content).slice(0, MAX_TTS_CHARS);

  if (!plainText) {
    return fallbackResult(config.voice);
  }

  const output = await synthesize(plainText, config, articleId);
  if (!output) {
    return fallbackResult(config.voice);
  }

  const { mimeType } = resolveOutputFormat(config.format);

  // Persist the audio: to object storage when configured (recording a
  // MediaAsset), else inline as base64 (the graceful default). Either way the
  // row carries enough to serve playback in both modes.
  let audioBase64: string | null = output.audio.toString("base64");
  let storageKey: string | null = null;
  let mediaAssetId: string | null = null;

  const storage = getMediaStorage();
  if (storage) {
    try {
      const put = await storage.put({
        data: output.audio,
        mimeType,
        keyHint: `speech/${articleId}`,
      });
      const durationSec = lastWordEnd(output.words);
      const asset = await prisma.mediaAsset.upsert({
        where: { storageKey: put.storageKey },
        update: {
          kind: "speech",
          mimeType,
          sizeBytes: put.sizeBytes,
          checksum: put.checksum,
          durationSec,
          voice: config.voice,
          format: config.format,
          articleId,
        },
        create: {
          storageKey: put.storageKey,
          kind: "speech",
          mimeType,
          sizeBytes: put.sizeBytes,
          checksum: put.checksum,
          durationSec,
          voice: config.voice,
          format: config.format,
          articleId,
        },
        select: { id: true },
      });
      storageKey = put.storageKey;
      mediaAssetId = asset.id;
      audioBase64 = null; // durably stored externally
    } catch (err) {
      log.error("speech.storage_write_failed", {
        articleId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Fall back to inline base64 so narration still works.
      storageKey = null;
      mediaAssetId = null;
      audioBase64 = output.audio.toString("base64");
    }
  }

  await prisma.articleSpeech.upsert({
    where: { articleId },
    update: {
      voice: config.voice,
      format: config.format,
      mimeType,
      audioBase64,
      storageKey,
      mediaAssetId,
      plainText,
      words: output.words,
    },
    create: {
      articleId,
      voice: config.voice,
      format: config.format,
      mimeType,
      audioBase64,
      storageKey,
      mediaAssetId,
      plainText,
      words: output.words,
    },
  });

  return {
    audio: `data:${mimeType};base64,${output.audio.toString("base64")}`,
    mimeType,
    plainText,
    words: output.words,
    voice: config.voice,
    cached: false,
    fallback: false,
  };
}
