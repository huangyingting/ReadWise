import { prisma } from "@/lib/prisma";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import {
  DEFAULT_SPEECH_VOICE,
  speechConfig,
} from "@/lib/runtime-config/speech";
import { createLogger } from "@/lib/logger";
import type { SpeechWord } from "@/lib/speech-timing";
import {
  getAiProcessableArticleById,
  isArticleOperator,
  SYSTEM_ARTICLE_CONTEXT,
  type ArticleAccessContext,
} from "@/lib/article-access";
import { synthesize, resolveMimeType } from "@/lib/speech/provider-azure";
import {
  parseStoredSpeechWords,
  resolveStoredAudioUrl,
  saveSpeechResult,
} from "@/lib/speech/repository";

const log = createLogger("speech");

/** Max characters of article text synthesized (bounds audio size / latency). */
const MAX_TTS_CHARS = 5000;

export type { SpeechWord } from "@/lib/speech-timing";

// Re-export so existing callers of `@/lib/speech` keep working.
export { parseStoredSpeechWords } from "@/lib/speech/repository";

export type SpeechResult = {
  audio: string | null;
  mimeType: string | null;
  plainText: string;
  words: SpeechWord[];
  voice: string;
  cached: boolean;
  fallback: boolean;
};

/** Whether Azure Speech credentials are configured. */
export function isSpeechConfigured(): boolean {
  return speechConfig.isConfigured();
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
    const articleForReaderText =
      allowedArticle ??
      (await prisma.article.findUnique({
        where: { id: articleId },
        select: { content: true },
      }));
    const plainText = articleForReaderText?.content
      ? articleHtmlToReaderText(articleForReaderText.content).slice(0, MAX_TTS_CHARS)
      : cached.plainText;
    return {
      audio: await resolveStoredAudioUrl(cached),
      mimeType: cached.mimeType,
      plainText,
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

  const config = speechConfig.get();
  if (!config) {
    return fallbackResult(DEFAULT_SPEECH_VOICE);
  }

  const plainText = articleHtmlToReaderText(article.content).slice(0, MAX_TTS_CHARS);

  if (!plainText) {
    return fallbackResult(config.voice);
  }

  const output = await synthesize(plainText, config, articleId);
  if (!output) {
    return fallbackResult(config.voice);
  }

  const mimeType = resolveMimeType(config.format);

  await saveSpeechResult({
    articleId,
    audio: output.audio,
    mimeType,
    voice: config.voice,
    format: config.format,
    plainText,
    words: output.words,
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
