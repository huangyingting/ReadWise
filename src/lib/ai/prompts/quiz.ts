import type { PromptTemplate, QuizPromptVars } from "./types";
import { TARGET_QUIZ_QUESTIONS } from "./types";
import { wrapUntrustedContent, CONTENT_ISOLATION_NOTICE } from "@/lib/ai/input-safety";

const quizTemplate: PromptTemplate<QuizPromptVars> = {
  feature: "quiz",
  version: "quiz/v1",
  active: true,
  modelParams: {},
  description: "Generate multiple-choice comprehension questions as JSON.",
  render: ({ title, source }) => [
    {
      role: "system",
      content:
        "You are an English reading-comprehension tutor. From the user's " +
        `article, write ${TARGET_QUIZ_QUESTIONS} multiple-choice comprehension ` +
        "questions that check whether a reader understood the text. Respond " +
        "ONLY with a JSON array. Each element must be an object with exactly " +
        'these keys: "question" (the question text), "options" (an array of ' +
        "3 or 4 distinct answer strings), and \"correctIndex\" (the 0-based " +
        "index of the single correct option). Exactly one option is correct. " +
        "No markdown, no commentary, JSON array only. " +
        CONTENT_ISOLATION_NOTICE,
    },
    {
      role: "user",
      content: `Title: ${title}\n\n${wrapUntrustedContent(source)}`,
    },
  ],
};

export default quizTemplate;
