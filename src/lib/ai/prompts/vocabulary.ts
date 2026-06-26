import type { PromptTemplate, VocabularyPromptVars } from "./types";
import { TARGET_VOCABULARY_WORDS } from "./types";
import { wrapUntrustedContent, CONTENT_ISOLATION_NOTICE } from "@/lib/ai/input-safety";

const vocabularyTemplate: PromptTemplate<VocabularyPromptVars> = {
  feature: "vocabulary",
  version: "vocabulary/v1",
  active: true,
  modelParams: {},
  description: "Extract the most useful/challenging learner vocabulary as JSON.",
  render: ({ title, source }) => [
    {
      role: "system",
      content:
        "You are an English vocabulary tutor. From the user's article, select the " +
        `${TARGET_VOCABULARY_WORDS} most useful, challenging vocabulary words or phrases for an ` +
        "English learner. Respond ONLY with a JSON array. Each element must be an " +
        'object with exactly these string keys: "word" (the term), "explanation" (a ' +
        'concise learner-friendly definition), and "example" (one short sample ' +
        "sentence using the word). No markdown, no commentary, JSON array only. " +
        CONTENT_ISOLATION_NOTICE,
    },
    {
      role: "user",
      content: `Title: ${title}\n\n${wrapUntrustedContent(source)}`,
    },
  ],
};

export default vocabularyTemplate;
