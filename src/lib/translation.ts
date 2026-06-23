import { prisma } from "@/lib/prisma";
import { aiModelName } from "@/lib/ai";
import { getOrCreateArticleAi } from "@/lib/ai-cache";
import { chunkForFeature } from "@/lib/ai/chunking";
import { renderPrompt, promptModelParams } from "@/lib/ai/prompts";
import type { ArticleAccessContext } from "@/lib/article-access";
import {
  languageLabel,
  isSupportedLanguage,
  SUPPORTED_LANGUAGES,
} from "@/lib/supported-languages";

export type { SupportedLanguage } from "@/lib/supported-languages";
export { SUPPORTED_LANGUAGES, isSupportedLanguage, languageLabel } from "@/lib/supported-languages";

export type TranslationResult = {
  lang: string;
  languageLabel: string;
  content: string;
  cached: boolean;
  fallback: boolean;
};

/**
 * Converts stored article HTML into plain text with blank-line paragraph
 * separators, suitable as model input and for paragraph-wise rendering.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

function fallbackText(label: string): string {
  return (
    `Translation into ${label} is unavailable right now because the AI ` +
    `translation service is not configured. Please try again later.`
  );
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
    { title: string; content: string },
    string,
    { content: string },
    TranslationResult
  >(
    articleId,
    {
      feature: "translation",
      maxOutputTokens: promptModelParams("translation").maxOutputTokens,
      readCache: async () => {
        const cached = await prisma.translation.findUnique({
          where: { articleId_targetLang: { articleId, targetLang: lang } },
        });
        return cached ? { content: cached.content } : null;
      },
      generate: async (article, { callModel }) => {
        const chunks = chunkForFeature(htmlToPlainText(article.content), "translation");
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
      },
      isEmpty: (text) => text.length === 0,
      persist: async (id, completion) => {
        const saved = await prisma.translation.upsert({
          where: { articleId_targetLang: { articleId: id, targetLang: lang } },
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
      fallback: () => ({
        lang,
        languageLabel: label,
        content: fallbackText(label),
        cached: false,
        fallback: true,
      }),
    },
    context,
  );
}
