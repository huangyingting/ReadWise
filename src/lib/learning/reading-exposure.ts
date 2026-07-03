/**
 * Reading → word-mastery exposure (#808).
 *
 * @server-only — imports Prisma.
 *
 * When a learner finishes reading an article, their saved words that naturally
 * appear in that article's text were re-encountered IN CONTEXT (not a flashcard
 * drill), so familiarity should be allowed to improve from real reading. This
 * module records one mastery exposure per saved word found in the article body.
 *
 * Privacy/safety: the article body is read transiently to MATCH against the
 * learner's own saved words and is never persisted, logged, or returned. Only an
 * integer count of matched words leaves this module — never word text, the
 * article body, definitions, examples, context sentences, or notes. Matching
 * reuses the canonical lemma so inflections collapse the same way WordMastery
 * keys them. Fully defensive: every failure is swallowed so a reading write is
 * never blocked or thrown into by mastery bookkeeping.
 */

import { prisma } from "@/lib/prisma";
import { lemmaFor } from "@/lib/lexical/normalize";
import { recordWordExposure } from "./word-mastery";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger("reading-exposure");

/** Upper bound on saved words processed per completion (defensive cap). */
const MAX_SAVED_WORDS = 1000;
const ARTICLE_TOKEN_PATTERN = /[a-z][a-z']*/g;

type SavedWordForExposure = { word: string };

/**
 * Build the set of canonical lemmas present in an article body. Tokens are
 * deduped before lemmatizing so cost scales with the article's vocabulary, not
 * its length.
 */
function lemmaSetFromText(text: string): Set<string> {
  const lemmas = new Set<string>();
  const rawTokens = text.toLowerCase().match(ARTICLE_TOKEN_PATTERN);
  if (!rawTokens) return lemmas;
  const uniqueRaw = new Set(rawTokens);
  for (const token of uniqueRaw) {
    const lemma = lemmaFor(token);
    if (lemma) lemmas.add(lemma);
  }
  return lemmas;
}

async function findSavedWordsForExposure(userId: string): Promise<SavedWordForExposure[]> {
  return prisma.savedWord.findMany({
    where: { userId },
    select: { word: true },
    take: MAX_SAVED_WORDS,
  });
}

async function findArticleContent(articleId: string): Promise<string | null> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { content: true },
  });
  return article?.content ?? null;
}

function savedWordsPresentInText(
  savedWords: readonly SavedWordForExposure[],
  presentLemmas: Set<string>,
): string[] {
  const exposeLemmas = new Map<string, string>();
  for (const { word } of savedWords) {
    const lemma = lemmaFor(word);
    if (lemma && presentLemmas.has(lemma) && !exposeLemmas.has(lemma)) {
      exposeLemmas.set(lemma, word);
    }
  }
  return Array.from(exposeLemmas.values());
}

async function recordExposureMatches(
  userId: string,
  articleId: string,
  words: readonly string[],
): Promise<number> {
  let recorded = 0;
  for (const word of words) {
    const result = await recordWordExposure(userId, word, { articleId });
    if (result) recorded += 1;
  }
  return recorded;
}

/**
 * Record reading exposures for the learner's saved words that appear in the
 * given article's text. Best-effort and user-scoped: returns the number of words
 * exposed (0 on any miss/failure) and never throws.
 *
 * @param userId     authenticated user id (scopes every query)
 * @param articleId  the article that was read to completion
 */
export async function recordReadingWordExposures(
  userId: string,
  articleId: string,
): Promise<number> {
  try {
    const savedWords = await findSavedWordsForExposure(userId);
    if (savedWords.length === 0) return 0;

    const articleContent = await findArticleContent(articleId);
    if (!articleContent) return 0;

    const present = lemmaSetFromText(articleContent);
    if (present.size === 0) return 0;

    const exposedWords = savedWordsPresentInText(savedWords, present);
    if (exposedWords.length === 0) return 0;

    return recordExposureMatches(userId, articleId, exposedWords);
  } catch (err) {
    // Mastery bookkeeping is best-effort — never disrupt the reading flow.
    log.error("reading word-exposure recording failed", {
      userId,
      articleId,
      err: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
