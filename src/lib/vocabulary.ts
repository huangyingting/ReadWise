import { prisma } from "@/lib/prisma";
import { getOrCreateArticleAi } from "@/lib/ai-cache";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import { boundedSampleForFeature } from "@/lib/ai/chunking";
import { renderPrompt, promptModelParams } from "@/lib/ai/prompts";
import { validateVocabulary } from "@/lib/ai/output/validators";
import type { ArticleAccessContext } from "@/lib/article-library";
import { getSavedWordSet } from "@/lib/lexical/saved-words";

export type VocabularyEntry = {
  word: string;
  explanation: string;
  example: string;
};

export type VocabularyItemResult = VocabularyEntry & {
  saved: boolean;
};

export type ArticleVocabularyResult = {
  articleId: string;
  items: VocabularyItemResult[];
  fallback: boolean;
};

/**
 * Parses the model's JSON response into vocabulary entries via the shared strict
 * validator (RW-024): tolerant of code fences/prose, rejects malformed/empty
 * items and dedups by word. Returns [] when nothing usable is found.
 */
function parseVocabularyJson(raw: string): VocabularyEntry[] {
  return validateVocabulary(raw).items;
}

/**
 * Returns cached extracted vocabulary for an article, generating and caching it
 * via the AI provider on a cache miss. When AI is unconfigured or the request
 * yields nothing, returns an empty list flagged as a fallback and caches nothing.
 */
export async function getOrCreateArticleVocabulary(
  articleId: string,
  userId: string,
  context?: ArticleAccessContext | null,
): Promise<ArticleVocabularyResult | null> {
  const toResult = async (
    entries: VocabularyEntry[],
    fallback: boolean,
  ): Promise<ArticleVocabularyResult> => {
    const savedSet = await getSavedWordSet(
      userId,
      entries.map((e) => e.word),
    );
    return {
      articleId,
      items: entries.map((e) => ({
        ...e,
        saved: savedSet.has(e.word.toLowerCase()),
      })),
      fallback,
    };
  };

  return getOrCreateArticleAi<
    { title: string; content: string },
    VocabularyEntry[],
    VocabularyEntry[],
    ArticleVocabularyResult
  >(
    articleId,
    {
      feature: "vocabulary",
      maxOutputTokens: promptModelParams("vocabulary").maxOutputTokens,
      readCache: async () => {
      const entries: VocabularyEntry[] = (
        await prisma.vocabularyItem.findMany({
          where: { articleId },
          orderBy: { createdAt: "asc" },
          select: { word: true, explanation: true, example: true },
        })
      ).map((v) => ({
        word: v.word,
        explanation: v.explanation,
        example: v.example,
      }));
      return entries.length > 0 ? entries : null;
      },
      buildMessages: (article) => {
      const source = boundedSampleForFeature(articleHtmlToReaderText(article.content), "vocabulary");
      return renderPrompt("vocabulary", { title: article.title, source });
      },
      parse: parseVocabularyJson,
      isEmpty: (entries) => entries.length === 0,
      persist: async (id, generated) => {
      await Promise.all(
        generated.map((entry) =>
          prisma.vocabularyItem.upsert({
            where: {
              articleId_word: { articleId: id, word: entry.word },
            },
            update: {
              explanation: entry.explanation,
              example: entry.example,
            },
            create: {
              articleId: id,
              word: entry.word,
              explanation: entry.explanation,
              example: entry.example,
            },
          }),
        ),
      );
      return generated;
      },
      toResult: (entries) => toResult(entries, false),
      fallback: () => toResult([], true),
    },
    context,
  );
}
