import { renderPrompt } from "@/lib/ai/prompts";
import { validateQuiz } from "@/lib/ai/output/validators";
import { str, num, pass } from "@/lib/ai/evals/assertions";
import type { FeatureEvaluator } from "@/lib/ai/evals/types";

const DEFAULT_MIN_ITEMS = 1;

type QuizItem = ReturnType<typeof validateQuiz>["items"][number];

function hasAtLeastTwoOptions(item: QuizItem): boolean {
  return item.options.length >= 2;
}

function hasValidCorrectIndex(item: QuizItem): boolean {
  return item.correctIndex >= 0 && item.correctIndex < item.options.length;
}

export const quizEvaluator: FeatureEvaluator = {
  feature: "quiz",
  buildMessages: (input) =>
    renderPrompt("quiz", { title: str(input.title), source: str(input.source) }),
  check: (output, _input, expect) => {
    const { items } = validateQuiz(output);
    const minItems = num(expect.minItems, DEFAULT_MIN_ITEMS);
    const allHave2Plus = items.every(hasAtLeastTwoOptions);
    const allValidIndex = items.every(hasValidCorrectIndex);
    return [
      pass("parses-min-items", items.length >= minItems, `parsed ${items.length} < ${minItems}`),
      pass("each-has-2plus-options", allHave2Plus, "a question had fewer than 2 options"),
      pass("valid-correct-index", allValidIndex, "a question had an out-of-range correctIndex"),
    ];
  },
};
