import type { PromptTemplate, GrammarPromptVars } from "./types";
import { sanitizeUntrustedText } from "@/lib/ai/input-safety";

const grammarTemplate: PromptTemplate<GrammarPromptVars> = {
  feature: "grammar",
  version: "grammar/v1",
  active: true,
  modelParams: { maxOutputTokens: 256 },
  description: "Explain a selected phrase/grammar pattern in plain English.",
  render: ({ phrase, context, level }) => {
    const safePhrase = sanitizeUntrustedText(phrase);
    const safeContext = sanitizeUntrustedText(context);
    return [
      {
        role: "system",
        content: `You are a friendly English tutor. Explain phrases and grammar in plain English suitable for a ${level} learner. Be concise (2–3 sentences). Do not use HTML.`,
      },
      {
        role: "user",
        content: safeContext
          ? `Explain the phrase "${safePhrase}" as used in this sentence: "${safeContext}". Is it a phrasal verb, idiom, collocation, or grammar pattern? Give one short example.`
          : `Explain the phrase "${safePhrase}". Is it a phrasal verb, idiom, collocation, or grammar pattern? Give one short example.`,
      },
    ];
  },
};

export default grammarTemplate;
