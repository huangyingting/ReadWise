import { prisma } from "@/lib/prisma";
import { chatComplete, isAiConfigured } from "@/lib/ai";
import { htmlToPlainText } from "@/lib/translation";

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

/** Max characters of source text sent to the model (keeps token use bounded). */
const MAX_SOURCE_CHARS = 8000;

/** How many vocabulary entries to request from the model. */
const TARGET_WORDS = 10;

/**
 * Parses the model's JSON response into vocabulary entries, tolerating markdown
 * code fences and surrounding prose. Returns [] when nothing usable is found.
 */
function parseVocabularyJson(raw: string): VocabularyEntry[] {
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const seen = new Set<string>();
  const entries: VocabularyEntry[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const record = row as Record<string, unknown>;
    const word = typeof record.word === "string" ? record.word.trim() : "";
    const explanation =
      typeof record.explanation === "string" ? record.explanation.trim() : "";
    const example =
      typeof record.example === "string" ? record.example.trim() : "";
    if (!word || !explanation) {
      continue;
    }
    const key = word.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({ word, explanation, example });
  }
  return entries;
}

async function generateVocabulary(
  title: string,
  content: string,
): Promise<VocabularyEntry[]> {
  const source = htmlToPlainText(content).slice(0, MAX_SOURCE_CHARS);
  const completion = await chatComplete([
    {
      role: "system",
      content:
        "You are an English vocabulary tutor. From the user's article, select the " +
        `${TARGET_WORDS} most useful, challenging vocabulary words or phrases for an ` +
        "English learner. Respond ONLY with a JSON array. Each element must be an " +
        'object with exactly these string keys: "word" (the term), "explanation" (a ' +
        'concise learner-friendly definition), and "example" (one short sample ' +
        "sentence using the word). No markdown, no commentary, JSON array only.",
    },
    {
      role: "user",
      content: `Title: ${title}\n\n${source}`,
    },
  ]);

  if (!completion) {
    return [];
  }
  return parseVocabularyJson(completion);
}

/**
 * Returns cached extracted vocabulary for an article, generating and caching it
 * via the AI provider on a cache miss. When AI is unconfigured or the request
 * yields nothing, returns an empty list flagged as a fallback and caches nothing.
 */
export async function getOrCreateArticleVocabulary(
  articleId: string,
  userId: string,
): Promise<ArticleVocabularyResult | null> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { id: true, title: true, content: true },
  });
  if (!article) {
    return null;
  }

  let entries: VocabularyEntry[] = (
    await prisma.vocabularyItem.findMany({
      where: { articleId },
      orderBy: { createdAt: "asc" },
      select: { word: true, explanation: true, example: true },
    })
  ).map((v) => ({ word: v.word, explanation: v.explanation, example: v.example }));

  let fallback = false;

  if (entries.length === 0) {
    if (!isAiConfigured()) {
      fallback = true;
    } else {
      const generated = await generateVocabulary(article.title, article.content);
      if (generated.length === 0) {
        fallback = true;
      } else {
        await Promise.all(
          generated.map((entry) =>
            prisma.vocabularyItem.upsert({
              where: {
                articleId_word: { articleId, word: entry.word },
              },
              update: {
                explanation: entry.explanation,
                example: entry.example,
              },
              create: {
                articleId,
                word: entry.word,
                explanation: entry.explanation,
                example: entry.example,
              },
            }),
          ),
        );
        entries = generated;
      }
    }
  }

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
  articleId: string | null;
  createdAt: Date;
};

/** All of a user's saved vocabulary, newest first. */
export async function getSavedWords(userId: string): Promise<SavedWordView[]> {
  return prisma.savedWord.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      word: true,
      explanation: true,
      example: true,
      articleId: true,
      createdAt: true,
    },
  });
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
      articleId: entry.articleId ?? undefined,
    },
    create: {
      userId,
      word,
      explanation: entry.explanation ?? null,
      example: entry.example ?? null,
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
