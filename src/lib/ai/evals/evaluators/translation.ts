import { renderPrompt } from "@/lib/ai/prompts";
import { str, pass, paragraphCount } from "@/lib/ai/evals/assertions";
import type { FeatureEvaluator } from "@/lib/ai/evals/types";

export const translationEvaluator: FeatureEvaluator = {
  feature: "translation",
  buildMessages: (input) =>
    renderPrompt("translation", {
      label: str(input.targetLangLabel, str(input.targetLang, "Spanish")),
      title: str(input.title),
      chunk: str(input.source),
      isPart: false,
    }),
  check: (output, input) => {
    const trimmed = output.trim();
    const expectedParagraphs = paragraphCount(str(input.source));
    const gotParagraphs = paragraphCount(trimmed);
    return [
      pass("non-empty", trimmed.length > 0, "translation was empty"),
      pass("no-markdown-fences", !trimmed.includes("```"), "output contained code fences"),
      pass(
        "preserves-paragraph-count",
        gotParagraphs === expectedParagraphs,
        `expected ${expectedParagraphs} paragraphs, got ${gotParagraphs}`,
      ),
    ];
  },
};
