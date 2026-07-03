import { renderPrompt } from "@/lib/ai/prompts";
import { moderateText } from "@/lib/ai/output/moderation";
import { str, pass, containsHtml } from "@/lib/ai/evals/assertions";
import type { FeatureEvaluator } from "@/lib/ai/evals/types";

const DEFAULT_LEVEL = "B1";

function trimOutput(output: string): string {
  return output.trim();
}

export const grammarEvaluator: FeatureEvaluator = {
  feature: "grammar",
  buildMessages: (input) =>
    renderPrompt("grammar", {
      phrase: str(input.phrase),
      context: str(input.context),
      level: str(input.level, DEFAULT_LEVEL),
    }),
  check: (output) => {
    const trimmed = trimOutput(output);
    return [
      pass("non-empty", trimmed.length > 0, "explanation was empty"),
      pass("no-html", !containsHtml(trimmed), "explanation contained HTML"),
      pass("not-flagged", !moderateText(trimmed).flagged, "explanation tripped moderation"),
    ];
  },
};
