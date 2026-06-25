import { renderPrompt } from "@/lib/ai/prompts";
import { validateQuiz } from "@/lib/ai/output/validators";
import { str, num, pass } from "@/lib/ai/evals/assertions";
import type { FeatureEvaluator } from "@/lib/ai/evals/types";

export const quizEvaluator: FeatureEvaluator = {
  feature: "quiz",
  buildMessages: (input) =>
    renderPrompt("quiz", { title: str(input.title), source: str(input.source) }),
  check: (output, _input, expect) => {
    const { items } = validateQuiz(output);
    const minItems = num(expect.minItems, 1);
    const allHave2Plus = items.every((q) => q.options.length >= 2);
    const allValidIndex = items.every(
      (q) => q.correctIndex >= 0 && q.correctIndex < q.options.length,
    );
    return [
      pass("parses-min-items", items.length >= minItems, `parsed ${items.length} < ${minItems}`),
      pass("each-has-2plus-options", allHave2Plus, "a question had fewer than 2 options"),
      pass("valid-correct-index", allValidIndex, "a question had an out-of-range correctIndex"),
    ];
  },
};
