import { renderPrompt } from "@/lib/ai/prompts";
import { parseLevel } from "@/lib/difficulty";
import { isDifficultyLevel } from "@/lib/leveling/cefr-primitives";
import { str, pass } from "@/lib/ai/evals/assertions";
import type { FeatureEvaluator, EvalPropertyResult } from "@/lib/ai/evals/types";

export const difficultyEvaluator: FeatureEvaluator = {
  feature: "difficulty",
  buildMessages: (input) =>
    renderPrompt("difficulty", { title: str(input.title), source: str(input.source) }),
  check: (output, _input, expect) => {
    const level = parseLevel(output);
    const results: EvalPropertyResult[] = [
      pass("valid-cefr-token", level != null, `could not parse a CEFR level from "${output}"`),
    ];
    const expected = str(expect.level);
    if (expected) {
      results.push(
        pass(
          "matches-expected-band",
          isDifficultyLevel(expected) && level === expected,
          `expected ${expected}, got ${level ?? "none"}`,
        ),
      );
    }
    return results;
  },
};
