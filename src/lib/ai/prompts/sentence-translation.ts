import type { PromptTemplate, SentenceTranslationPromptVars } from "./types";
import { sanitizeUntrustedText } from "@/lib/ai/input-safety";

const sentenceTranslationTemplate: PromptTemplate<SentenceTranslationPromptVars> = {
  feature: "sentence-translation",
  version: "sentence-translation/v1",
  active: true,
  modelParams: { maxOutputTokens: 256 },
  description: "Translate a single selected sentence/phrase, learner-friendly.",
  render: ({ label, text }) => [
    {
      role: "system",
      content:
        `Translate the following sentence or phrase from an English article into ${label}. ` +
        "Return ONLY the translation, natural and learner-friendly.",
    },
    { role: "user", content: sanitizeUntrustedText(text) },
  ],
};

export default sentenceTranslationTemplate;
