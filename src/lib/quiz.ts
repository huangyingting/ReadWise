import { prisma } from "@/lib/prisma";
import { getOrCreateArticleAi } from "@/lib/ai/cache";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import { boundedSampleForFeature } from "@/lib/ai/chunking";
import { renderPrompt, promptModelParams } from "@/lib/ai/prompts";
import { validateQuiz } from "@/lib/ai/output/validators";
import type { ArticleAccessContext } from "@/lib/article-library";
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

type QuizArticle = { title: string; content: string };

type StoredQuizQuestion = {
  question: string;
  options: Prisma.JsonValue | null | undefined;
  correctIndex: number;
};

function storedQuizQuestionToResult(row: StoredQuizQuestion): QuizQuestion {
  return {
    question: row.question,
    options: parseStoredOptions(row.options),
    correctIndex: row.correctIndex,
  };
}

async function readCachedQuiz(articleId: string): Promise<QuizQuestion[] | null> {
  const questions = (
    await prisma.quizQuestion.findMany({
      where: { articleId },
      orderBy: { createdAt: "asc" },
      select: { question: true, options: true, correctIndex: true },
    })
  ).map(storedQuizQuestionToResult);
  return questions.length > 0 ? questions : null;
}

function buildQuizMessages(article: QuizArticle) {
  const source = boundedSampleForFeature(articleHtmlToReaderText(article.content), "quiz");
  return renderPrompt("quiz", { title: article.title, source });
}

async function upsertQuizQuestion(articleId: string, question: QuizQuestion) {
  return prisma.quizQuestion.upsert({
    where: {
      articleId_question: { articleId, question: question.question },
    },
    update: {
      options: question.options,
      correctIndex: question.correctIndex,
    },
    create: {
      articleId,
      question: question.question,
      options: question.options,
      correctIndex: question.correctIndex,
    },
  });
}

async function persistQuizQuestions(
  articleId: string,
  generated: QuizQuestion[],
): Promise<QuizQuestion[]> {
  await Promise.all(generated.map((question) => upsertQuizQuestion(articleId, question)));
  return generated;
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
    QuizArticle,
    QuizQuestion[],
    QuizQuestion[],
    ArticleQuizResult
  >(
    articleId,
    {
      feature: "quiz",
      maxOutputTokens: promptModelParams("quiz").maxOutputTokens,
      readCache: () => readCachedQuiz(articleId),
      buildMessages: buildQuizMessages,
      parse: (completion) => validateQuiz(completion).items,
      isEmpty: (questions) => questions.length === 0,
      persist: persistQuizQuestions,
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
