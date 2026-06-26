import type { PromptTemplate, TutorPromptVars } from "./types";
import { sanitizeUntrustedText, wrapUntrustedContent, CONTENT_ISOLATION_NOTICE } from "@/lib/ai/input-safety";

const tutorTemplate: PromptTemplate<TutorPromptVars> = {
  feature: "tutor",
  version: "tutor/v1",
  active: true,
  modelParams: { maxOutputTokens: 2048 },
  description: "Article-grounded conversational tutor, calibrated to CEFR level.",
  render: ({ level, title, articleText, question }) => [
    {
      role: "system",
      content:
        `You are a friendly English-learning tutor. The user is reading the article below.\n` +
        `Answer ONLY questions about this article, grounded strictly in its text. Be concise and clear.\n` +
        `Adjust your vocabulary and sentence complexity to approximately CEFR level ${level}.\n` +
        `If the answer is not in the article, say so briefly (1–2 sentences) and do not speculate.\n` +
        `${CONTENT_ISOLATION_NOTICE}\n\n` +
        `ARTICLE TITLE: "${title}"\n` +
        `---\n` +
        wrapUntrustedContent(articleText),
    },
    {
      role: "user",
      content: sanitizeUntrustedText(question),
    },
  ],
};

export default tutorTemplate;
