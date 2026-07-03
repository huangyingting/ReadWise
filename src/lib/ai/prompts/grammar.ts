import type { PromptTemplate, GrammarPromptVars } from "./types";
import { sanitizeUntrustedText } from "@/lib/ai/input-safety";

function renderUserPrompt(phrase: string, context: string): string {
  if (!context) {
    return `Explain the phrase "${phrase}". Is it a phrasal verb, idiom, collocation, or grammar pattern? Give one short example.`;
  }

  return `Explain the phrase "${phrase}" as used in this sentence: "${context}". Is it a phrasal verb, idiom, collocation, or grammar pattern? Give one short example.`;
}

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
        content: renderUserPrompt(safePhrase, safeContext),
      },
    ];
  },
};

export default grammarTemplate;
