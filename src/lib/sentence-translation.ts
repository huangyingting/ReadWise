import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { isSupportedLanguage, languageLabel } from "@/lib/translation";
import { renderPrompt, promptModelParams, activePromptVersion } from "@/lib/ai/prompts";
import {
  getAiProcessableArticleById,
  isArticleOperator,
  SYSTEM_ARTICLE_CONTEXT,
  type ArticleAccessContext,
} from "@/lib/article-access";
import { getOrCreateSelectionAi } from "@/lib/ai-cache";

/** Maximum source text length accepted for sentence translation. */
export const MAX_SENTENCE_CHARS = 1000;

export type SentenceTranslationResult = {
  translation: string | null;
  fallback: boolean;
};

/** Normalizes whitespace so different representations of the same text share a cache entry. */
function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Stable SHA-256 hex hash used as the DB cache key. */
function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Translates a sentence or phrase from an article into the given target language.
 *
 * Cache-first: looked up by (articleId, SHA-256 of normalized text, targetLang).
 * On a miss the translation is generated via the AI provider and persisted.
 * When the AI provider is not configured or the request fails, returns
 * `{ translation: null, fallback: true }` without writing to the cache.
 *
 * Returns `null` when the article does not exist (→ 404 at the route layer).
 */
export async function translateSentence(
  articleId: string,
  text: string,
  lang: string,
  context: ArticleAccessContext | null = SYSTEM_ARTICLE_CONTEXT,
): Promise<SentenceTranslationResult | null> {
  const normalized = normalizeText(text);

  // Inputs are pre-validated by the route, but the lib is still defensive.
  if (!normalized || normalized.length > MAX_SENTENCE_CHARS || !isSupportedLanguage(lang)) {
    return { translation: null, fallback: true };
  }

  const sourceHash = hashText(normalized);

  const allowedArticle = !isArticleOperator(context)
    ? await getAiProcessableArticleById(articleId, context, { select: { id: true } })
    : null;
  if (!isArticleOperator(context) && !allowedArticle) {
    return null;
  }

  // Verify the article exists (gives caller a proper 404 on miss).
  const article =
    allowedArticle ??
    (await prisma.article.findUnique({
      where: { id: articleId },
      select: { id: true },
    }));
  if (!article) return null;

  const label = languageLabel(lang);

  return getOrCreateSelectionAi<SentenceTranslationResult>({
    feature: "sentence-translation",
    promptVersion: activePromptVersion("sentence-translation"),
    articleId,
    maxOutputTokens: promptModelParams("sentence-translation").maxOutputTokens,
    readCache: async () => {
      const cached = await prisma.sentenceTranslation.findUnique({
        where: {
          articleId_sourceHash_targetLang: { articleId, sourceHash, targetLang: lang },
        },
      });
      return cached ? { translation: cached.translation, fallback: false } : null;
    },
    generate: (callModel) =>
      callModel(renderPrompt("sentence-translation", { label, text: normalized })),
    persist: async (completion) => {
      await prisma.sentenceTranslation.create({
        data: { articleId, sourceHash, targetLang: lang, sourceText: normalized, translation: completion },
      });
      return { translation: completion, fallback: false };
    },
    fallback: () => ({ translation: null, fallback: true }),
  });
}
