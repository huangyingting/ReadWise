import { prisma } from "@/lib/prisma";
import { getOrCreateArticleAi } from "@/lib/ai-cache";
import { htmlToPlainText } from "@/lib/translation";

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

/** Max characters of source text sent to the model (keeps token use bounded). */
const MAX_SOURCE_CHARS = 8000;

/** How many comprehension questions to request from the model. */
const TARGET_QUESTIONS = 5;

/**
 * Parses the model's JSON response into quiz questions, tolerating markdown code
 * fences and surrounding prose. Returns [] when nothing usable is found. Each
 * question must have a non-empty prompt, at least two options, and a
 * `correctIndex` that points at a real option.
 */
export function parseQuizJson(raw: string): QuizQuestion[] {
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
  const questions: QuizQuestion[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const record = row as Record<string, unknown>;
    const question =
      typeof record.question === "string" ? record.question.trim() : "";
    const rawOptions = Array.isArray(record.options) ? record.options : [];
    const options = rawOptions
      .map((o) => (typeof o === "string" ? o.trim() : ""))
      .filter((o) => o.length > 0);
    const correctIndex =
      typeof record.correctIndex === "number"
        ? Math.trunc(record.correctIndex)
        : -1;

    if (
      !question ||
      options.length < 2 ||
      correctIndex < 0 ||
      correctIndex >= options.length
    ) {
      continue;
    }

    const key = question.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    questions.push({ question, options, correctIndex });
  }
  return questions;
}

/**
 * Returns the cached comprehension quiz for an article, generating and caching
 * it via the AI provider on a cache miss. When AI is unconfigured or the request
 * yields nothing, returns an empty list flagged as a fallback and caches nothing
 * (so a real quiz can replace the placeholder on a later request).
 */
export async function getOrCreateArticleQuiz(
  articleId: string,
): Promise<ArticleQuizResult | null> {
  return getOrCreateArticleAi<
    { title: string; content: string },
    QuizQuestion[],
    QuizQuestion[],
    ArticleQuizResult
  >(articleId, {
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
        options: safeParseOptions(q.options),
        correctIndex: q.correctIndex,
      }));
      return questions.length > 0 ? questions : null;
    },
    buildMessages: (article) => {
      const source = htmlToPlainText(article.content).slice(0, MAX_SOURCE_CHARS);
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
              options: JSON.stringify(q.options),
              correctIndex: q.correctIndex,
            },
            create: {
              articleId: id,
              question: q.question,
              options: JSON.stringify(q.options),
              correctIndex: q.correctIndex,
            },
          }),
        ),
      );
      return generated;
    },
    toResult: (questions) => ({ articleId, questions, fallback: false }),
    fallback: () => ({ articleId, questions: [], fallback: true }),
  });
}

/** Parses a stored options JSON string into an array of strings (never throws). */
function safeParseOptions(raw: string): string[] {
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
