import { renderPrompt } from "@/lib/ai/prompts";
import { validateVocabulary } from "@/lib/ai/validation";
import { str, num, pass } from "@/lib/ai/evals/assertions";
import type { FeatureEvaluator } from "@/lib/ai/evals/types";

export const vocabularyEvaluator: FeatureEvaluator = {
  feature: "vocabulary",
  buildMessages: (input) =>
    renderPrompt("vocabulary", { title: str(input.title), source: str(input.source) }),
  check: (output, _input, expect) => {
    const { items } = validateVocabulary(output);
    const minItems = num(expect.minItems, 1);
    const allHaveWordAndExplanation = items.every(
      (i) => i.word.trim().length > 0 && i.explanation.trim().length > 0,
    );
    const uniqueWords = new Set(items.map((i) => i.word.toLowerCase())).size;
    return [
      pass("parses-min-items", items.length >= minItems, `parsed ${items.length} < ${minItems}`),
      pass(
        "items-have-word-and-explanation",
        allHaveWordAndExplanation,
        "an item was missing word or explanation",
      ),
      pass("no-duplicate-words", uniqueWords === items.length, "duplicate words present"),
    ];
  },
};
