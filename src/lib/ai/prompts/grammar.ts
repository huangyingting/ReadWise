import type { PromptTemplate, GrammarPromptVars } from "./types";

const grammarTemplate: PromptTemplate<GrammarPromptVars> = {
  feature: "grammar",
  version: "grammar/v1",
  active: true,
  modelParams: { maxOutputTokens: 256 },
  description: "Explain a selected phrase/grammar pattern in plain English.",
  render: ({ phrase, context, level }) => [
    {
      role: "system",
      content: `You are a friendly English tutor. Explain phrases and grammar in plain English suitable for a ${level} learner. Be concise (2–3 sentences). Do not use HTML.`,
    },
    {
      role: "user",
      content: context
        ? `Explain the phrase "${phrase}" as used in this sentence: "${context}". Is it a phrasal verb, idiom, collocation, or grammar pattern? Give one short example.`
        : `Explain the phrase "${phrase}". Is it a phrasal verb, idiom, collocation, or grammar pattern? Give one short example.`,
    },
  ],
};

export default grammarTemplate;
