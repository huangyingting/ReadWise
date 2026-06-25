/**
 * Grammar-in-context explanations (#114).
 *
 * `explainGrammar` returns an AI-generated explanation of a selected phrase
 * (phrasal verb, idiom, collocation, or grammar pattern). Results are cached
 * per (articleId, normalised phrase) so repeated lookups cost nothing.
 *
 * Graceful fallback: when the AI provider is not configured or the request
 * fails, returns `{ explanation: null, fallback: true }` without writing to
 * the cache.
 */
import { prisma } from "@/lib/prisma";
import { chatComplete, isAiConfigured } from "@/lib/ai";
import { moderateText } from "@/lib/ai/output/moderation";
import { renderPrompt, promptModelParams, activePromptVersion } from "@/lib/ai/prompts";

export type GrammarResult = {
  explanation: string | null;
  fallback: boolean;
};

export const MAX_PHRASE_CHARS = 200;
export const MAX_CONTEXT_CHARS = 500;

/** Normalise whitespace and case so variants share a cache row. */
function normalizePhrase(phrase: string): string {
  return phrase.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Returns an AI-generated explanation of the given phrase in context.
 *
 * 1. Checks the `GrammarExplanation` cache (articleId + normalised phrase).
 * 2. On a miss, calls the AI provider with a level-appropriate prompt.
 * 3. Caches and returns the result on success; returns a graceful fallback on
 *    failure / missing credentials.
 */
export async function explainGrammar(
  articleId: string,
  phrase: string,
  contextSentence: string,
  level: string,
): Promise<GrammarResult> {
  const normalized = normalizePhrase(phrase);
  if (!normalized || normalized.length > MAX_PHRASE_CHARS) {
    return { explanation: null, fallback: true };
  }

  // 1. Cache hit
  const cached = await prisma.grammarExplanation.findUnique({
    where: { articleId_phrase: { articleId, phrase: normalized } },
  });
  if (cached) {
    return { explanation: cached.explanation, fallback: false };
  }

  // 2. AI generation
  if (!isAiConfigured()) {
    return { explanation: null, fallback: true };
  }

  const ctx = contextSentence.trim().slice(0, MAX_CONTEXT_CHARS);
  const levelLabel = level || "B1";

  const messages = renderPrompt("grammar", {
    phrase,
    context: ctx,
    level: levelLabel,
  });

  const text = await chatComplete(messages, {
    maxOutputTokens: promptModelParams("grammar").maxOutputTokens,
    feature: "grammar",
    promptVersion: activePromptVersion("grammar"),
    articleId,
  });
  if (!text) {
    return { explanation: null, fallback: true };
  }

  // Safety: don't cache or surface an unsafe explanation (RW-024).
  if (moderateText(text).flagged) {
    return { explanation: null, fallback: true };
  }

  // 3. Cache the result
  await prisma.grammarExplanation.upsert({
    where: { articleId_phrase: { articleId, phrase: normalized } },
    create: { articleId, phrase: normalized, explanation: text },
    update: { explanation: text },
  });

  return { explanation: text, fallback: false };
}
