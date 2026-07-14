import { prisma } from "@/lib/prisma";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import {
  DEFAULT_SPEECH_VOICE,
  speechConfig,
} from "@/lib/runtime-config/speech";
import { isTtsFeatureEnabled } from "@/lib/runtime-config/feature-flags";
import { createLogger } from "@/lib/observability/logger";
import type { SpeechWord } from "./timing";
import {
  getAiProcessableArticleById,
  isArticleOperator,
  SYSTEM_ARTICLE_CONTEXT,
  type ArticleAccessContext,
} from "@/lib/article-library";
import { synthesize, resolveMimeType } from "./provider-azure";
import {
  parseStoredSpeechWords,
  resolveStoredAudioUrl,
  saveSpeechResult,
} from "./repository";

const log = createLogger("speech");

/** Max characters of article text synthesized (bounds audio size / latency). */
const MAX_TTS_CHARS = 5000;

// ── Barrel re-exports ────────────────────────────────────────────────────────
// Keep @/lib/speech as the single external entry for all speech subsystem APIs.
export type {
  WordTiming,
  SpeechWord,
  SpeechTimingPayload,
  SpeechTimingPayloadV1,
  SpeechTimingPayloadV2,
  SpeechTimingProvider,
  ParsedSpeechTimingPayload,
  TextToken,
  ComparableToken,
} from "./timing";
export {
  WORD_PATTERN,
  SPEECH_BOUNDARY_PATTERN,
  createWordRegex,
  createSpeechBoundaryRegex,
  createComparableKey,
  createAlphanumericKey,
  extractTextTokens,
  extractSpeechBoundaryTokens,
  timingStartSeconds,
  timingEndSeconds,
  createSpeechTimingPayloadV1,
  createSpeechTimingPayloadV2,
  legacySpeechWordsToTimingPayloadV1,
  legacySpeechWordsToTimingPayloadV2,
  parseSpeechTimingPayload,
} from "./timing";
export { buildTokenAlignment } from "./timing-alignment";
export type { PracticeSentenceOptions, SpeechPracticeSegment } from "./practice";
export {
  splitPracticeSentences,
  findSpeechSentenceRange,
  segmentSpeechPractice,
} from "./practice";
export { getArticleSpeechAudio } from "./repository";

export type SpeechResult = {
  audio: string | null;
  mimeType: string | null;
  plainText: string;
  words: SpeechWord[];
  voice: string;
  cached: boolean;
  fallback: boolean;
  fallbackReason?:
    | "tts_unconfigured"
    | "empty_text"
    | "synthesis_failed"
    | "storage_unavailable"
    | "cache_audio_missing";
};

type ArticleSpeechSource = {
  title?: string | null;
  content: string;
};

/** Whether Azure Speech credentials are configured and TTS is enabled. */
export function isSpeechConfigured(): boolean {
  return isTtsFeatureEnabled() && speechConfig.isConfigured();
}

function fallbackResult(
  voice: string,
  fallbackReason: NonNullable<SpeechResult["fallbackReason"]>,
): SpeechResult {
  return {
    audio: null,
    mimeType: null,
    plainText: "",
    words: [],
    voice,
    cached: false,
    fallback: true,
    fallbackReason,
  };
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
  const articleOperator = isArticleOperator(context);
  const allowedArticle = !articleOperator
    ? await getAiProcessableArticleById(articleId, context, {
        select: { title: true, content: true },
      })
    : null;
  if (!articleOperator && !allowedArticle) {
    return null;
  }

  const cached = await prisma.articleSpeech.findUnique({
    where: { articleId },
  });
  if (cached) {
    return cachedSpeechResult(articleId, context, allowedArticle, cached);
  }

  const article = allowedArticle ?? (await findArticleForSpeech(articleId));
  if (!article) {
    return null;
  }

  return synthesizeArticleSpeech(articleId, article);
}

async function cachedSpeechResult(
  articleId: string,
  context: ArticleAccessContext | null,
  allowedArticle: ArticleSpeechSource | null,
  cached: Awaited<ReturnType<typeof prisma.articleSpeech.findUnique>>,
): Promise<SpeechResult | null> {
  if (!cached) {
    return null;
  }

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

  const plainText = await cachedPlainText(articleId, cached.plainText, allowedArticle);
  const audio = await resolveStoredAudioUrl(cached);
  return {
    audio,
    mimeType: cached.mimeType,
    plainText,
    words,
    voice: cached.voice,
    cached: true,
    fallback: !audio,
    ...(!audio ? { fallbackReason: "cache_audio_missing" as const } : {}),
  };
}

async function cachedPlainText(
  articleId: string,
  fallbackPlainText: string,
  allowedArticle: ArticleSpeechSource | null,
): Promise<string> {
  const articleForReaderText =
    allowedArticle ??
    (await prisma.article.findUnique({
      where: { id: articleId },
      select: { content: true },
    }));
  return articleForReaderText?.content
    ? articleHtmlToReaderText(articleForReaderText.content).slice(0, MAX_TTS_CHARS)
    : fallbackPlainText;
}

async function findArticleForSpeech(articleId: string): Promise<ArticleSpeechSource | null> {
  return prisma.article.findUnique({
    where: { id: articleId },
    select: { title: true, content: true },
  });
}

async function synthesizeArticleSpeech(
  articleId: string,
  article: ArticleSpeechSource,
): Promise<SpeechResult> {
  const config = isTtsFeatureEnabled() ? speechConfig.get() : null;
  if (!config) {
    return fallbackResult(DEFAULT_SPEECH_VOICE, "tts_unconfigured");
  }

  const plainText = articleHtmlToReaderText(article.content).slice(0, MAX_TTS_CHARS);

  if (!plainText) {
    return fallbackResult(config.voice, "empty_text");
  }

  const output = await synthesize(plainText, config, articleId);
  if (!output) {
    return fallbackResult(config.voice, "synthesis_failed");
  }

  const mimeType = resolveMimeType(config.format);

  const persisted = await saveSpeechResult({
    articleId,
    audio: output.audio,
    mimeType,
    voice: config.voice,
    format: config.format,
    plainText,
    provider: output.provider,
    words: output.words,
  });

  return {
    audio: `data:${mimeType};base64,${output.audio.toString("base64")}`,
    mimeType,
    plainText,
    words: output.words,
    voice: config.voice,
    cached: false,
    fallback: !persisted,
    ...(!persisted ? { fallbackReason: "storage_unavailable" as const } : {}),
  };
}
