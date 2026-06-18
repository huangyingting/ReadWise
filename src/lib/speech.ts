import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { prisma } from "@/lib/prisma";
import { htmlToPlainText } from "@/lib/translation";

/** Max characters of article text synthesized (bounds audio size / latency). */
const MAX_TTS_CHARS = 5000;

const DEFAULT_VOICE = "en-US-AndrewMultilingualNeural";

/** A single spoken word with timings (seconds) and source-text position. */
export type SpeechWord = {
  textOffset: number;
  length: number;
  start: number;
  end: number;
};

export type SpeechResult = {
  audio: string | null;
  mimeType: string | null;
  spokenText: string;
  words: SpeechWord[];
  voice: string;
  cached: boolean;
  fallback: boolean;
};

type AzureSpeechConfig = {
  key: string;
  region: string;
  voice: string;
  format: string;
};

function readSpeechConfig(): AzureSpeechConfig | null {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    return null;
  }
  return {
    key,
    region,
    voice: process.env.AZURE_SPEECH_VOICE || DEFAULT_VOICE,
    format:
      process.env.AZURE_SPEECH_OUTPUT_FORMAT ||
      "audio-24khz-96kbitrate-mono-mp3",
  };
}

/** Whether Azure Speech credentials are configured. */
export function isSpeechConfigured(): boolean {
  return readSpeechConfig() !== null;
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

/** Ticks (100-nanosecond units) to seconds. */
function ticksToSeconds(ticks: number): number {
  return ticks / 1e7;
}

type SynthesisOutput = {
  audio: Buffer;
  words: SpeechWord[];
};

/**
 * Synthesizes `text` via Azure Speech, collecting word-boundary timings.
 * Resolves null on any failure so callers can degrade gracefully.
 */
function synthesize(
  text: string,
  config: AzureSpeechConfig,
): Promise<SynthesisOutput | null> {
  return new Promise((resolve) => {
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
        words.push({
          textOffset: e.textOffset,
          length: e.wordLength,
          start: ticksToSeconds(e.audioOffset),
          end: ticksToSeconds(e.audioOffset + e.duration),
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
            words.sort((a, b) => a.start - b.start);
            resolve({ audio: Buffer.from(audioData), words });
          } else {
            resolve(null);
          }
        },
        () => {
          synthesizer?.close();
          synthesizer = null;
          resolve(null);
        },
      );
    } catch {
      synthesizer?.close();
      resolve(null);
    }
  });
}

function fallbackResult(voice: string): SpeechResult {
  return {
    audio: null,
    mimeType: null,
    spokenText: "",
    words: [],
    voice,
    cached: false,
    fallback: true,
  };
}

/**
 * Returns cached narration audio + word timings for an article, generating and
 * caching them via Azure Speech on a cache miss. Degrades gracefully (no cache)
 * when credentials are absent or synthesis fails.
 */
export async function getOrCreateArticleSpeech(
  articleId: string,
): Promise<SpeechResult | null> {
  const cached = await prisma.articleSpeech.findUnique({
    where: { articleId },
  });
  if (cached) {
    return {
      audio: `data:${cached.mimeType};base64,${cached.audioBase64}`,
      mimeType: cached.mimeType,
      spokenText: cached.spokenText,
      words: JSON.parse(cached.words) as SpeechWord[],
      voice: cached.voice,
      cached: true,
      fallback: false,
    };
  }

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { title: true, content: true },
  });
  if (!article) {
    return null;
  }

  const config = readSpeechConfig();
  if (!config) {
    return fallbackResult(DEFAULT_VOICE);
  }

  const spokenText = htmlToPlainText(article.content)
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TTS_CHARS);

  if (!spokenText) {
    return fallbackResult(config.voice);
  }

  const output = await synthesize(spokenText, config);
  if (!output) {
    return fallbackResult(config.voice);
  }

  const { mimeType } = resolveOutputFormat(config.format);
  const audioBase64 = output.audio.toString("base64");

  await prisma.articleSpeech.upsert({
    where: { articleId },
    update: {
      voice: config.voice,
      format: config.format,
      mimeType,
      audioBase64,
      spokenText,
      words: JSON.stringify(output.words),
    },
    create: {
      articleId,
      voice: config.voice,
      format: config.format,
      mimeType,
      audioBase64,
      spokenText,
      words: JSON.stringify(output.words),
    },
  });

  return {
    audio: `data:${mimeType};base64,${audioBase64}`,
    mimeType,
    spokenText,
    words: output.words,
    voice: config.voice,
    cached: false,
    fallback: false,
  };
}
