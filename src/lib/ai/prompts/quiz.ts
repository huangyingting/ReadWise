import type { PromptTemplate, QuizPromptVars } from "./types";
import { TARGET_QUIZ_QUESTIONS } from "./types";
import { wrapUntrustedContent, CONTENT_ISOLATION_NOTICE } from "@/lib/ai/input-safety";
import { READING_SKILL_KEYS } from "@/lib/learning/reading-skills";

const QUIZ_SYSTEM_PROMPT =
  "You are an English reading-comprehension tutor. From the user's " +
  `article, write ${TARGET_QUIZ_QUESTIONS} multiple-choice comprehension ` +
  "questions that check whether a reader understood the text. Respond " +
  "ONLY with a JSON array. Each element must be an object with exactly " +
  'these keys: "question" (the question text), "options" (an array of ' +
  "3 or 4 distinct answer strings), and \"correctIndex\" (the 0-based " +
  "index of the single correct option), \"skill\" (the reading skill the " +
  `question checks, exactly one of: ${READING_SKILL_KEYS.join(", ")}), and ` +
  '"explanation" (one or two sentences explaining why the correct option is ' +
  "right, pointing to the text). Exactly one option is correct. Vary the " +
  "skills across questions. No markdown, no commentary, JSON array only. " +
  CONTENT_ISOLATION_NOTICE;

function renderArticleUserContent({ title, source }: QuizPromptVars): string {
  return `Title: ${title}\n\n${wrapUntrustedContent(source)}`;
}

const quizTemplate: PromptTemplate<QuizPromptVars> = {
  feature: "quiz",
  version: "quiz/v2",
  active: true,
  modelParams: {},
  description: "Generate skill-tagged multiple-choice comprehension questions with rationales as JSON.",
  render: ({ title, source }) => [
    {
      role: "system",
      content: QUIZ_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: renderArticleUserContent({ title, source }),
    },
  ],
};

export default quizTemplate;
