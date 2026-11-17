import { prisma } from "@/lib/prisma";
import { getOrCreateArticleAi } from "@/lib/ai/cache";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import { boundedSampleForFeature } from "@/lib/ai/chunking";
import { renderPrompt, promptModelParams } from "@/lib/ai/prompts";
import { validateQuiz } from "@/lib/ai/output/validators";
import type { ArticleAccessContext } from "@/lib/article-library";
import type { Prisma } from "@prisma/client";
import type { AiFallbackReason } from "@/lib/ai/fallback-reasons";
import {
  isReadingSkill,
  classifyQuestionSkill,
  standardCodeFor,
  type ReadingSkill,
} from "@/lib/learning/reading-skills";

export type QuizQuestion = {
  /** Stored `QuizQuestion.id` (links per-question attempt answers). */
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  /** Reading skill the question checks (#1302). */
  skillTag: ReadingSkill;
  /** Anchor standard for the skill, e.g. "CCRA.R.2". */
  standardCode: string;
  /** Answer rationale, shown after submission; null when unavailable. */
  explanation: string | null;
};

/** A freshly generated question before it is stored. */
type GeneratedQuizQuestion = Omit<QuizQuestion, "id" | "standardCode">;

export type ArticleQuizResult = {
  articleId: string;
  questions: QuizQuestion[];
  fallback: boolean;
  fallbackReason?: AiFallbackReason;
};

type QuizArticle = { title: string; content: string };

type StoredQuizQuestion = {
  id: string;
  question: string;
  options: Prisma.JsonValue | null | undefined;
  correctIndex: number;
  skillTag: string;
  explanation: string | null;
};

const STORED_QUIZ_QUESTION_SELECT = {
  id: true,
  question: true,
  options: true,
  correctIndex: true,
  skillTag: true,
  explanation: true,
} as const;

function storedQuizQuestionToResult(row: StoredQuizQuestion): QuizQuestion {
  const skillTag = isReadingSkill(row.skillTag) ? row.skillTag : classifyQuestionSkill(row.question);
  return {
    id: row.id,
    question: row.question,
    options: parseStoredOptions(row.options),
    correctIndex: row.correctIndex,
    skillTag,
    standardCode: standardCodeFor(skillTag),
    explanation: row.explanation,
  };
}

/** Stored quiz questions for an article (no AI call), or null when none exist yet. */
export async function readCachedQuiz(articleId: string): Promise<QuizQuestion[] | null> {
  const questions = (
    await prisma.quizQuestion.findMany({
      where: { articleId },
      orderBy: { createdAt: "asc" },
      select: STORED_QUIZ_QUESTION_SELECT,
    })
  ).map(storedQuizQuestionToResult);
  return questions.length > 0 ? questions : null;
}

function buildQuizMessages(article: QuizArticle) {
  const source = boundedSampleForFeature(articleHtmlToReaderText(article.content), "quiz");
  return renderPrompt("quiz", { title: article.title, source });
}

async function upsertQuizQuestion(articleId: string, question: GeneratedQuizQuestion) {
  const fields = {
    options: question.options,
    correctIndex: question.correctIndex,
    skillTag: question.skillTag,
    standardCode: standardCodeFor(question.skillTag),
    explanation: question.explanation,
  };
  return prisma.quizQuestion.upsert({
    where: {
      articleId_question: { articleId, question: question.question },
    },
    update: fields,
    create: { articleId, question: question.question, ...fields },
    select: STORED_QUIZ_QUESTION_SELECT,
  });
}

/** Stores generated questions and returns them as stored rows, in generation order. */
async function persistQuizQuestions(
  articleId: string,
  generated: GeneratedQuizQuestion[],
): Promise<QuizQuestion[]> {
  const rows = await Promise.all(generated.map((question) => upsertQuizQuestion(articleId, question)));
  return rows.map(storedQuizQuestionToResult);
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
    GeneratedQuizQuestion[],
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
      fallback: (_article, ctx) => ({
        articleId,
        questions: [],
        fallback: true,
        ...(ctx?.reason ? { fallbackReason: ctx.reason } : {}),
      }),
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
