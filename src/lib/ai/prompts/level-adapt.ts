import type { PromptTemplate, LevelAdaptPromptVars } from "./types";
import { wrapUntrustedContent, CONTENT_ISOLATION_NOTICE } from "@/lib/ai/input-safety";

const levelAdaptTemplate: PromptTemplate<LevelAdaptPromptVars> = {
  feature: "level-adapt",
  version: "level-adapt/v1",
  active: true,
  modelParams: { maxOutputTokens: 2400 },
  description: "Rewrite an article at a CEFR reading level, keeping facts, order, and names (#1303).",
  render: ({ title, source, level, targetLexile }) => [
    {
      role: "system",
      content:
        `You adapt news articles for English learners. Rewrite the article for a CEFR ${level} reader ` +
        `(about ${targetLexile}L): use vocabulary and sentence length suited to ${level}, keep every key ` +
        "fact, name, number, and the original order, and do not add opinions or new information. " +
        "Return ONLY a JSON array of strings: the first string is the adapted headline and each " +
        "following string is one paragraph. No HTML, no markdown. " +
        CONTENT_ISOLATION_NOTICE,
    },
    { role: "user", content: `Title: ${title}\n\n${wrapUntrustedContent(source)}` },
  ],
};

export default levelAdaptTemplate;
