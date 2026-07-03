import type { PromptTemplate, SentenceTranslationPromptVars } from "./types";
import { sanitizeUntrustedText } from "@/lib/ai/input-safety";

const FEATURE = "sentence-translation";
const VERSION = "sentence-translation/v1";
const MODEL_PARAMS = { maxOutputTokens: 256 };
const DESCRIPTION = "Translate a single selected sentence/phrase, learner-friendly.";
const RESPONSE_INSTRUCTION = "Return ONLY the translation, natural and learner-friendly.";

function renderSystemPrompt(label: string): string {
  return `Translate the following sentence or phrase from an English article into ${label}. ${RESPONSE_INSTRUCTION}`;
}

const sentenceTranslationTemplate: PromptTemplate<SentenceTranslationPromptVars> = {
  feature: FEATURE,
  version: VERSION,
  active: true,
  modelParams: MODEL_PARAMS,
  description: DESCRIPTION,
  render: ({ label, text }) => [
    {
      role: "system",
      content: renderSystemPrompt(label),
    },
    { role: "user", content: sanitizeUntrustedText(text) },
  ],
};

export default sentenceTranslationTemplate;
