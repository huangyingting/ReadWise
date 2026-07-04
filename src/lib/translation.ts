import { prisma } from "@/lib/prisma";
import { aiModelName } from "@/lib/ai";
import { getOrCreateArticleAi, type CallModel } from "@/lib/ai/cache";
import { chunkForFeature } from "@/lib/ai/chunking";
import { renderPrompt, promptModelParams } from "@/lib/ai/prompts";
import type { ArticleAccessContext } from "@/lib/article-library";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import {
  languageLabel,
  isSupportedLanguage,
  SUPPORTED_LANGUAGES,
} from "@/lib/supported-languages";
import { t } from "@/lib/i18n";
import type { AiFallbackReason } from "@/lib/ai/fallback-reasons";

export type { SupportedLanguage } from "@/lib/supported-languages";
export { SUPPORTED_LANGUAGES, isSupportedLanguage, languageLabel } from "@/lib/supported-languages";

export type TranslationResult = {
  lang: string;
  languageLabel: string;
  content: string;
  cached: boolean;
  fallback: boolean;
  fallbackReason?: AiFallbackReason;
};

type TranslationCache = { content: string };
type TranslationArticle = { title: string; content: string };

function translationWhere(articleId: string, lang: string) {
  return { articleId_targetLang: { articleId, targetLang: lang } };
}

async function translateChunks(
  article: TranslationArticle,
  label: string,
  callModel: CallModel,
): Promise<string | null> {
  const chunks = chunkForFeature(articleHtmlToReaderText(article.content), "translation");
  if (chunks.length === 0) {
    return null;
  }

  const parts: string[] = [];
  for (const chunk of chunks) {
    const completion = await callModel(
      renderPrompt("translation", {
        label,
        title: article.title,
        chunk,
        isPart: chunks.length > 1,
      }),
    );
    // Any chunk failing → fallback; never cache a partial translation.
    if (!completion) {
      return null;
    }
    parts.push(completion.trim());
  }
  return parts.join("\n\n");
}

/**
 * Returns the cached translation for an article+language, generating and
 * caching it via the AI provider on a cache miss. Long articles are translated
 * in token-bounded CHUNKS (RW-025) so the full text is covered without
 * exceeding the model context; any failed chunk degrades to a graceful
 * placeholder that is NOT cached (so a real translation can replace it later).
 */
export async function getOrCreateTranslation(
  articleId: string,
  lang: string,
  context?: ArticleAccessContext | null,
): Promise<TranslationResult | null> {
  const label = languageLabel(lang);

  return getOrCreateArticleAi<
    TranslationArticle,
    string,
    TranslationCache,
    TranslationResult
  >(
    articleId,
    {
      feature: "translation",
      maxOutputTokens: promptModelParams("translation").maxOutputTokens,
      readCache: async () => {
        const cached = await prisma.translation.findUnique({
          where: translationWhere(articleId, lang),
        });
        return cached ? { content: cached.content } : null;
      },
      generate: (article, { callModel }) => translateChunks(article, label, callModel),
      isEmpty: (text) => text.length === 0,
      persist: async (id, completion) => {
        const saved = await prisma.translation.upsert({
          where: translationWhere(id, lang),
          update: { content: completion, model: aiModelName() },
          create: {
            articleId: id,
            targetLang: lang,
            content: completion,
            model: aiModelName(),
          },
        });
        return { content: saved.content };
      },
      toResult: (cache, { cached }) => ({
        lang,
        languageLabel: label,
        content: cache.content,
        cached,
        fallback: false,
      }),
      fallback: (_article, ctx) => ({
        lang,
        languageLabel: label,
        content: t("reader.translate.unavailable", { lang: label }),
        cached: false,
        fallback: true,
        ...(ctx?.reason ? { fallbackReason: ctx.reason } : {}),
      }),
    },
    context,
  );
}
