import { prisma } from "@/lib/prisma";
import { getOrCreateArticleAi } from "@/lib/ai-cache";
import { htmlToPlainText } from "@/lib/translation";
import { boundedSampleForFeature } from "@/lib/ai/chunking";
import { validateQuiz } from "@/lib/ai/validation";
import type { ArticleAccessContext } from "@/lib/article-access";
import type { Prisma } from "@prisma/client";

export type QuizQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
};

export type ArticleQuizResult = {
  articleId: string;
  questions: QuizQuestion[];
  fallback: boolean;
};

/** How many comprehension questions to request from the model. */
const TARGET_QUESTIONS = 5;

/**
 * Parses the model's JSON response into quiz questions via the shared strict
 * validator (RW-024): tolerant of code fences/prose, rejects questions without
 * a prompt, with fewer than two options, or with an out-of-range correctIndex.
 * Returns [] when nothing usable is found.
 */
export function parseQuizJson(raw: string): QuizQuestion[] {
  return validateQuiz(raw).items;
}

/**
 * Returns the cached comprehension quiz for an article, generating and caching
 * it via the AI provider on a cache miss. When AI is unconfigured or the request
 * yields nothing, returns an empty list flagged as a fallback and caches nothing
 * (so a real quiz can replace the placeholder on a later request).
 */
export async function getOrCreateArticleQuiz(
  articleId: string,
  context?: ArticleAccessContext | null,
): Promise<ArticleQuizResult | null> {
  return getOrCreateArticleAi<
    { title: string; content: string },
    QuizQuestion[],
    QuizQuestion[],
    ArticleQuizResult
  >(
    articleId,
    {
      feature: "quiz",
      readCache: async () => {
        const questions: QuizQuestion[] = (
          await prisma.quizQuestion.findMany({
            where: { articleId },
            orderBy: { createdAt: "asc" },
            select: { question: true, options: true, correctIndex: true },
          })
        ).map((q) => ({
          question: q.question,
          options: parseStoredOptions(q.options),
          correctIndex: q.correctIndex,
        }));
        return questions.length > 0 ? questions : null;
      },
      buildMessages: (article) => {
        const source = boundedSampleForFeature(htmlToPlainText(article.content), "quiz");
        return [
          {
            role: "system",
            content:
              "You are an English reading-comprehension tutor. From the user's " +
              `article, write ${TARGET_QUESTIONS} multiple-choice comprehension ` +
              "questions that check whether a reader understood the text. Respond " +
              "ONLY with a JSON array. Each element must be an object with exactly " +
              'these keys: "question" (the question text), "options" (an array of ' +
              "3 or 4 distinct answer strings), and \"correctIndex\" (the 0-based " +
              "index of the single correct option). Exactly one option is correct. " +
              "No markdown, no commentary, JSON array only.",
          },
          {
            role: "user",
            content: `Title: ${article.title}\n\n${source}`,
          },
        ];
      },
      parse: parseQuizJson,
      isEmpty: (questions) => questions.length === 0,
      persist: async (id, generated) => {
        await Promise.all(
          generated.map((q) =>
            prisma.quizQuestion.upsert({
              where: {
                articleId_question: { articleId: id, question: q.question },
              },
              update: {
                options: q.options,
                correctIndex: q.correctIndex,
              },
              create: {
                articleId: id,
                question: q.question,
                options: q.options,
                correctIndex: q.correctIndex,
              },
            }),
          ),
        );
        return generated;
      },
      toResult: (questions) => ({ articleId, questions, fallback: false }),
      fallback: () => ({ articleId, questions: [], fallback: true }),
    },
    context,
  );
}

/** Parses stored option JSON values (or legacy JSON strings) into strings. */
export function parseStoredOptions(
  raw: Prisma.JsonValue | string | null | undefined,
): string[] {
  if (raw == null) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw.filter((o): o is string => typeof o === "string");
  }

  if (typeof raw !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((o): o is string => typeof o === "string");
    }
  } catch {
    // fall through
  }
  return [];
}
