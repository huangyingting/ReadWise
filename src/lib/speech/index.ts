import { prisma } from "@/lib/prisma";
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
  parseStoredSpeechTimingPayload,
  resolveStoredSpeechMediaMetadata,
  saveSpeechResult,
} from "./repository";
import {
  prepareNarrationText,
  REALTIME_NARRATION_TEXT_BASIS,
  resolveStoredNarrationTextBasis,
  type NarrationTextBasis,
} from "./text-basis";

const log = createLogger("speech");

// Narration delivery is the public root interface. Runtime timing, alignment,
// practice, and migration tooling use their explicit public modules.
export { getArticleSpeechAudio } from "./repository";

export type SpeechResult = {
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

  const timing = parseStoredSpeechTimingPayload(cached.words);
  if (!timing) {
    log.error("speech.cache_parse_failure", {
      articleId,
      error: "Malformed cached word timings",
    });
    // Treat the corrupt row as a cache miss — fall through to regenerate.
    await prisma.articleSpeech.delete({ where: { articleId } });
    return getOrCreateArticleSpeech(articleId, context);
  }

  const [plainText, media] = await Promise.all([
    cachedPlainText(
      articleId,
      allowedArticle,
      resolveStoredNarrationTextBasis(timing.textBasis, timing.provider),
    ),
    resolveStoredSpeechMediaMetadata(cached),
  ]);
  if (plainText === null) {
    return null;
  }
  const audioAvailable = media?.available ?? false;
  return {
    mimeType: media?.mimeType ?? null,
    plainText,
    words: timing.words,
    voice: media?.voice ?? DEFAULT_SPEECH_VOICE,
    cached: true,
    fallback: !audioAvailable,
    ...(!audioAvailable ? { fallbackReason: "cache_audio_missing" as const } : {}),
  };
}

async function cachedPlainText(
  articleId: string,
  allowedArticle: ArticleSpeechSource | null,
  basis: NarrationTextBasis,
): Promise<string | null> {
  const articleForReaderText =
    allowedArticle ??
    (await prisma.article.findUnique({
      where: { id: articleId },
      select: { content: true },
    }));
  if (!articleForReaderText) {
    return null;
  }
  return prepareNarrationText(articleForReaderText.content, basis).plainText;
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

  const narrationText = prepareNarrationText(
    article.content,
    REALTIME_NARRATION_TEXT_BASIS,
  );
  const { plainText } = narrationText;

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
    provider: output.provider,
    words: output.words,
    textBasis: narrationText.basis,
  });

  return {
    mimeType,
    plainText,
    words: output.words,
    voice: config.voice,
    cached: false,
    fallback: !persisted,
    ...(!persisted ? { fallbackReason: "storage_unavailable" as const } : {}),
  };
}
