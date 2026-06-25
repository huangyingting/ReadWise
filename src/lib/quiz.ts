import { prisma } from "@/lib/prisma";
import { getOrCreateArticleAi } from "@/lib/ai-cache";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import { boundedSampleForFeature } from "@/lib/ai/chunking";
import { renderPrompt, promptModelParams } from "@/lib/ai/prompts";
import { validateQuiz } from "@/lib/ai/output/validators";
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
      maxOutputTokens: promptModelParams("quiz").maxOutputTokens,
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
        const source = boundedSampleForFeature(articleHtmlToReaderText(article.content), "quiz");
        return renderPrompt("quiz", { title: article.title, source });
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

/** Parses stored option JSON values into strings. */
export function parseStoredOptions(raw: Prisma.JsonValue | null | undefined): string[] {
  if (raw == null) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw.filter((o): o is string => typeof o === "string");
  }

  return [];
}
