import { prisma } from "@/lib/prisma";
import { getOrCreateArticleAi } from "@/lib/ai-cache";
import { htmlToPlainText } from "@/lib/translation";
import { boundedSampleForFeature } from "@/lib/ai/chunking";
import { renderPrompt, promptModelParams } from "@/lib/ai/prompts";
import { validateVocabulary } from "@/lib/ai/validation";
import type { ArticleAccessContext } from "@/lib/article-access";

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
      const source = boundedSampleForFeature(htmlToPlainText(article.content), "vocabulary");
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

/**
 * Returns the lowercased set of words from `words` that the user has saved.
 * Matching is case-insensitive against the stored saved words.
 */
export async function getSavedWordSet(
  userId: string,
  words: string[],
): Promise<Set<string>> {
  if (words.length === 0) {
    return new Set();
  }
  const saved = await prisma.savedWord.findMany({
    where: { userId },
    select: { word: true },
  });
  const savedLower = new Set(saved.map((s) => s.word.toLowerCase()));
  const result = new Set<string>();
  for (const w of words) {
    if (savedLower.has(w.toLowerCase())) {
      result.add(w.toLowerCase());
    }
  }
  return result;
}

export type SavedWordView = {
  id: string;
  word: string;
  explanation: string | null;
  example: string | null;
  contextSentence: string | null;
  articleId: string | null;
  createdAt: Date;
  dueAt: Date | null;
};

const SAVED_WORD_SELECT = {
  id: true,
  word: true,
  explanation: true,
  example: true,
  contextSentence: true,
  articleId: true,
  createdAt: true,
  dueAt: true,
} as const;

/** All of a user's saved vocabulary, newest first. */
export async function getSavedWords(userId: string): Promise<SavedWordView[]> {
  return prisma.savedWord.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: SAVED_WORD_SELECT,
  });
}

export const WORDS_PAGE_SIZE = 20;

export type FilteredWordsResult = {
  words: SavedWordView[];
  total: number;
  page: number;
  totalPages: number;
};

/**
 * Paginated, searchable list of a user's saved words.
 *
 * @param search  - filter by word text or explanation (case-insensitive LIKE)
 * @param articleId - filter by the article the word was saved from
 * @param filter  - "due" = SRS due now; "new" = never reviewed; "all" (default)
 * @param page    - 1-based page index
 */
export async function getFilteredSavedWords(
  userId: string,
  opts: {
    search?: string;
    articleId?: string;
    filter?: "all" | "due" | "new";
    page?: number;
  } = {},
): Promise<FilteredWordsResult> {
  const { search, articleId, filter = "all", page = 1 } = opts;
  const skip = (Math.max(1, page) - 1) * WORDS_PAGE_SIZE;

  const now = new Date();

  const where = {
    userId,
    ...(search
      ? {
          OR: [
            { word: { contains: search } },
            { explanation: { contains: search } },
          ],
        }
      : {}),
    ...(articleId ? { articleId } : {}),
    ...(filter === "due"
      ? { OR: [{ dueAt: null }, { dueAt: { lte: now } }] }
      : filter === "new"
        ? { dueAt: null }
        : {}),
  };

  const [total, words] = await Promise.all([
    prisma.savedWord.count({ where }),
    prisma.savedWord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: WORDS_PAGE_SIZE,
      select: SAVED_WORD_SELECT,
    }),
  ]);

  return {
    words,
    total,
    page: Math.max(1, page),
    totalPages: Math.max(1, Math.ceil(total / WORDS_PAGE_SIZE)),
  };
}

/**
 * Saves a word to the user's study list. Idempotent: an existing entry for the
 * same (user, word) is updated rather than duplicated (enforced by @@unique).
 */
export async function saveWord(
  userId: string,
  entry: {
    word: string;
    explanation?: string | null;
    example?: string | null;
    contextSentence?: string | null;
    articleId?: string | null;
  },
): Promise<void> {
  const word = entry.word.trim();
  if (!word) {
    return;
  }
  await prisma.savedWord.upsert({
    where: { userId_word: { userId, word } },
    update: {
      explanation: entry.explanation ?? undefined,
      example: entry.example ?? undefined,
      contextSentence: entry.contextSentence ?? undefined,
      articleId: entry.articleId ?? undefined,
    },
    create: {
      userId,
      word,
      explanation: entry.explanation ?? null,
      example: entry.example ?? null,
      contextSentence: entry.contextSentence ?? null,
      articleId: entry.articleId ?? null,
    },
  });
}

/** Removes a word from the user's study list. No-op if it isn't saved. */
export async function unsaveWord(userId: string, word: string): Promise<void> {
  const trimmed = word.trim();
  if (!trimmed) {
    return;
  }
  await prisma.savedWord.deleteMany({ where: { userId, word: trimmed } });
}
