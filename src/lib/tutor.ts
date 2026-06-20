/**
 * M12 — AI Tutor.
 *
 * Provides a per-user, per-article conversational tutor grounded in the
 * article text. Conversation turns are persisted in `TutorMessage`; fallback
 * responses (AI unconfigured / request failure) are NEVER persisted.
 */

import { prisma } from "@/lib/prisma";
import { chatComplete, isAiConfigured } from "@/lib/ai";
import { htmlToPlainText } from "@/lib/translation";
import { getProfile } from "@/lib/profile";

/** Max characters of article plain-text sent to the model as grounding. */
const MAX_ARTICLE_CHARS = 7000;

/** Max recent messages replayed into the prompt (10 user + 10 assistant). */
const MAX_PRIOR_MESSAGES = 20;

/** Max characters allowed in a single user question. */
export const MAX_QUESTION_LENGTH = 1000;

/** Default CEFR level used when the user has no profile. */
const DEFAULT_LEVEL = "B1";

/** Friendly message returned when the AI service is unavailable. */
const FALLBACK_ANSWER =
  "I'm sorry, the AI tutor is unavailable right now. Please try again later.";

export type TutorMessageDto = {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
};

export type AskTutorResult = {
  answer: string;
  fallback: boolean;
  messages: TutorMessageDto[];
};

/** Returns the full conversation for a user+article, oldest first. */
export async function getTutorMessages(
  userId: string,
  articleId: string,
): Promise<TutorMessageDto[]> {
  return prisma.tutorMessage.findMany({
    where: { userId, articleId },
    select: { id: true, role: true, content: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
}

/**
 * Sends a question to the AI tutor, grounded in the article text.
 *
 * Returns null if the article doesn't exist (caller should 404).
 * On AI success: persists both messages, returns `{answer, fallback:false}`.
 * On AI unconfigured or failure: returns `{answer: <friendly text>, fallback:true}`
 * without persisting anything.
 */
export async function askTutor(
  userId: string,
  articleId: string,
  question: string,
): Promise<AskTutorResult | null> {
  // Load article and user profile in parallel.
  const [article, profile] = await Promise.all([
    prisma.article.findUnique({
      where: { id: articleId },
      select: { title: true, content: true },
    }),
    getProfile(userId),
  ]);

  if (!article) {
    return null;
  }

  // Fetch recent prior turns (most recent first, then reverse to chronological).
  const rawPrior = await prisma.tutorMessage.findMany({
    where: { userId, articleId },
    select: { role: true, content: true },
    orderBy: { createdAt: "desc" },
    take: MAX_PRIOR_MESSAGES,
  });
  const priorMessages = rawPrior.reverse();

  const englishLevel = profile?.englishLevel ?? DEFAULT_LEVEL;

  // Graceful fallback when AI is not configured.
  if (!isAiConfigured()) {
    return {
      answer: FALLBACK_ANSWER,
      fallback: true,
      messages: await getTutorMessages(userId, articleId),
    };
  }

  // Build grounding context from article plain text, capped for token safety.
  const plainText = htmlToPlainText(article.content);
  const truncated = plainText.length > MAX_ARTICLE_CHARS;
  const articleText = truncated
    ? plainText.slice(0, MAX_ARTICLE_CHARS) +
      "\n\n[Excerpt — the article continues beyond this point.]"
    : plainText;

  const systemPrompt =
    `You are a friendly English-learning tutor. The user is reading the article below.\n` +
    `Answer ONLY questions about this article, grounded strictly in its text. Be concise and clear.\n` +
    `Adjust your vocabulary and sentence complexity to approximately CEFR level ${englishLevel}.\n` +
    `If the answer is not in the article, say so briefly (1–2 sentences) and do not speculate.\n\n` +
    `ARTICLE TITLE: "${article.title}"\n` +
    `---\n` +
    articleText;

  const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...priorMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: question },
  ];

  const completion = await chatComplete(chatMessages, { maxOutputTokens: 512 });

  if (!completion) {
    // AI configured but request failed — graceful fallback, persist nothing.
    return {
      answer: FALLBACK_ANSWER,
      fallback: true,
      messages: await getTutorMessages(userId, articleId),
    };
  }

  // Persist user question then assistant answer atomically.
  await prisma.$transaction([
    prisma.tutorMessage.create({
      data: { userId, articleId, role: "user", content: question },
    }),
    prisma.tutorMessage.create({
      data: { userId, articleId, role: "assistant", content: completion },
    }),
  ]);

  return {
    answer: completion,
    fallback: false,
    messages: await getTutorMessages(userId, articleId),
  };
}

/** Deletes the entire conversation for a user+article ("clear chat"). */
export async function clearTutor(userId: string, articleId: string): Promise<void> {
  await prisma.tutorMessage.deleteMany({ where: { userId, articleId } });
}
