import { renderPrompt } from "@/lib/ai/prompts";
import { validateVocabulary } from "@/lib/ai/output/validators";
import { str, num, pass } from "@/lib/ai/evals/assertions";
import type { FeatureEvaluator } from "@/lib/ai/evals/types";

type VocabularyItem = ReturnType<typeof validateVocabulary>["items"][number];

function hasWordAndExplanation(item: VocabularyItem): boolean {
  return item.word.trim().length > 0 && item.explanation.trim().length > 0;
}

function countUniqueWords(items: VocabularyItem[]): number {
  return new Set(items.map((item) => item.word.toLowerCase())).size;
}

export const vocabularyEvaluator: FeatureEvaluator = {
  feature: "vocabulary",
  buildMessages: (input) =>
    renderPrompt("vocabulary", { title: str(input.title), source: str(input.source) }),
  check: (output, _input, expect) => {
    const { items } = validateVocabulary(output);
    const minItems = num(expect.minItems, 1);
    const allHaveWordAndExplanation = items.every(hasWordAndExplanation);
    const uniqueWords = countUniqueWords(items);
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
