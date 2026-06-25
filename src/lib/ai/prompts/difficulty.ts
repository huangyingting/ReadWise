import type { PromptTemplate, DifficultyPromptVars } from "./types";

const difficultyTemplate: PromptTemplate<DifficultyPromptVars> = {
  feature: "difficulty",
  version: "difficulty/v1",
  active: true,
  modelParams: { maxOutputTokens: 16 },
  description: "Assess CEFR reading difficulty; reply with one A1–C2 token.",
  render: ({ title, source }) => [
    {
      role: "system",
      content:
        "You assess the reading difficulty of English texts for language " +
        "learners using the CEFR scale. Reply with exactly one level from " +
        "A1, A2, B1, B2, C1, C2 — the level a learner needs to comfortably " +
        "read the text. Respond with the two-character level only, no other " +
        "words.",
    },
    {
      role: "user",
      content: `Title: ${title}\n\n${source}`,
    },
  ],
};

export default difficultyTemplate;
