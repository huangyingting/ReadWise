/**
 * M12 — AI Tutor.
 *
 * Provides a per-user, per-article conversational tutor grounded in the
 * article text. Conversation turns are persisted in `TutorMessage`; fallback
 * responses (AI unconfigured / request failure) are NEVER persisted.
 */

import { prisma } from "@/lib/prisma";
import { chatComplete, isAiConfigured } from "@/lib/ai";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import { moderateText, MODERATION_FALLBACK_MESSAGE } from "@/lib/ai/output/moderation";
import { renderPrompt, promptModelParams, activePromptVersion } from "@/lib/ai/prompts";
import { getProfile } from "@/lib/profile";
import {
  getAiProcessableArticleById,
  isArticleOperator,
  SYSTEM_ARTICLE_CONTEXT,
  type ArticleAccessContext,
} from "@/lib/article-access";

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
  "AI feature unavailable — the AI tutor is not available right now. Please try again later.";

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
 *
 * @param paragraphContext — (#377) optional current reading paragraph. When
 *   provided, it is appended to the user message so the tutor can give a more
 *   localised answer. Privacy rule: ONLY the paragraph of the article the user
 *   is currently viewing is sent — never personal data or other article text.
 */
export async function askTutor(
  userId: string,
  articleId: string,
  question: string,
  context: ArticleAccessContext | null = SYSTEM_ARTICLE_CONTEXT,
  paragraphContext?: string,
): Promise<AskTutorResult | null> {
  // Load article and user profile in parallel.
  const [article, profile] = await Promise.all([
    isArticleOperator(context)
      ? prisma.article.findUnique({
          where: { id: articleId },
          select: { title: true, content: true },
        })
      : getAiProcessableArticleById(articleId, context, {
          select: { title: true, content: true },
        }),
    getProfile(userId),
  ]);

  if (!article) {
    return null;
  }

  // Safety: refuse obviously-unsafe questions up front (RW-024). Cheap heuristic
  // check; benign learning questions are unaffected. Persist nothing.
  if (moderateText(question).flagged) {
    return {
      answer: MODERATION_FALLBACK_MESSAGE,
      fallback: true,
      messages: await getTutorMessages(userId, articleId),
    };
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
  const plainText = articleHtmlToReaderText(article.content);
  const truncated = plainText.length > MAX_ARTICLE_CHARS;
  const articleText = truncated
    ? plainText.slice(0, MAX_ARTICLE_CHARS) +
      "\n\n[Excerpt — the article continues beyond this point.]"
    : plainText;

  // The active prompt template renders the article-grounded system message and
  // the final user question; prior conversation turns are spliced between them.
  // #377: when a paragraph context is available, append it as a soft hint so
  // the tutor can give a more localised answer.  Only the current paragraph of
  // the article the user is reading is included — no other personal data.
  const MAX_PARA_CONTEXT = 500;
  const contextualQuestion =
    paragraphContext && paragraphContext.trim().length > 0
      ? `${question}\n\n[Current paragraph the user is reading: "${paragraphContext.trim().slice(0, MAX_PARA_CONTEXT)}"]`
      : question;

  const [systemMessage, userMessage] = renderPrompt("tutor", {
    level: englishLevel,
    title: article.title,
    articleText,
    question: contextualQuestion,
  });

  const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    systemMessage,
    ...priorMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    userMessage,
  ];

  const completion = await chatComplete(chatMessages, {
    maxOutputTokens: promptModelParams("tutor").maxOutputTokens,
    feature: "tutor",
    promptVersion: activePromptVersion("tutor"),
    articleId,
  });

  if (!completion) {
    // AI configured but request failed — graceful fallback, persist nothing.
    return {
      answer: FALLBACK_ANSWER,
      fallback: true,
      messages: await getTutorMessages(userId, articleId),
    };
  }

  // Safety: never show/persist an unsafe model answer (RW-024). Degrade to a
  // safe fallback and persist nothing.
  if (moderateText(completion).flagged) {
    return {
      answer: MODERATION_FALLBACK_MESSAGE,
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
