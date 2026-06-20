import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { chatComplete, isAiConfigured } from "@/lib/ai";
import { isSupportedLanguage, languageLabel } from "@/lib/translation";

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
): Promise<SentenceTranslationResult | null> {
  const normalized = normalizeText(text);

  // Inputs are pre-validated by the route, but the lib is still defensive.
  if (!normalized || normalized.length > MAX_SENTENCE_CHARS || !isSupportedLanguage(lang)) {
    return { translation: null, fallback: true };
  }

  const sourceHash = hashText(normalized);

  // 1) Cache hit — the FK cascade guarantees the article still exists.
  const cached = await prisma.sentenceTranslation.findUnique({
    where: {
      articleId_sourceHash_targetLang: { articleId, sourceHash, targetLang: lang },
    },
  });
  if (cached) {
    return { translation: cached.translation, fallback: false };
  }

  // 2) Verify the article exists (gives caller a proper 404 on miss).
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { id: true },
  });
  if (!article) return null;

  // 3) AI unavailable → graceful fallback, nothing cached.
  if (!isAiConfigured()) {
    return { translation: null, fallback: true };
  }

  const label = languageLabel(lang);
  const completion = await chatComplete(
    [
      {
        role: "system",
        content:
          `Translate the following sentence or phrase from an English article into ${label}. ` +
          "Return ONLY the translation, natural and learner-friendly.",
      },
      { role: "user", content: normalized },
    ],
    { maxOutputTokens: 256 },
  );

  // 4) AI configured but request failed → graceful fallback, nothing cached.
  if (!completion) {
    return { translation: null, fallback: true };
  }

  // 5) Persist the new translation.
  await prisma.sentenceTranslation.create({
    data: { articleId, sourceHash, targetLang: lang, sourceText: normalized, translation: completion },
  });

  return { translation: completion, fallback: false };
}
