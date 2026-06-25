/**
 * Saved-word repository and read models (REF-048).
 *
 * All persistence for a user's explicit saved-word study list: upsert, delete,
 * paginated/filtered reads, and set-membership queries.
 *
 * Intentional design notes:
 *   - Saved-word matching is case-insensitive (getSavedWordSet lowercases both
 *     sides) so "Robust" and "robust" resolve to the same saved entry.
 *   - Mastery tracking is separate: saved words are the explicit SRS study list;
 *     `WordMastery` rows track every word the user encounters regardless of
 *     whether it was saved. An explicit save triggers a mastery exposure
 *     (handled at the call site, not here).
 *   - Cloze grading uses its own stem-based matching rather than saved-word
 *     equality; the two match closely for base forms but differ on inflections
 *     by design (cloze should accept "runs" for an answer of "run").
 */

import { prisma } from "@/lib/prisma";
import {
  readableArticleWhere,
  type ArticleAccessContext,
} from "@/lib/article-library/policy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export type FilteredWordsResult = {
  words: SavedWordView[];
  total: number;
  page: number;
  totalPages: number;
};

export const WORDS_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Select shape (reused across queries)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Repository functions
// ---------------------------------------------------------------------------

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

/** All of a user's saved vocabulary, newest first. */
export async function getSavedWords(userId: string): Promise<SavedWordView[]> {
  return prisma.savedWord.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: SAVED_WORD_SELECT,
  });
}

/**
 * Paginated, searchable list of a user's saved words.
 *
 * @param search    - filter by word text or explanation (case-insensitive LIKE)
 * @param articleId - filter by the article the word was saved from
 * @param filter    - "due" = SRS due now; "new" = never reviewed; "all" (default)
 * @param page      - 1-based page index
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

/**
 * Returns a map of article id → title for all accessible articles in
 * `articleIds`, filtered by `context`. Articles the caller cannot read (due to
 * visibility or status) are silently omitted. Returns an empty object when
 * `articleIds` is empty.
 *
 * Used by the vocabulary-journal page to resolve display titles for words that
 * were saved while reading a particular article.
 */
export async function getArticleTitlesForWords(
  articleIds: string[],
  context: ArticleAccessContext,
): Promise<Record<string, string>> {
  if (articleIds.length === 0) {
    return {};
  }
  const rows = await prisma.article.findMany({
    where: readableArticleWhere(context, { id: { in: articleIds } }),
    select: { id: true, title: true },
  });
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.id] = row.title;
  }
  return result;
}
