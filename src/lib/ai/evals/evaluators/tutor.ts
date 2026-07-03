import { renderPrompt } from "@/lib/ai/prompts";
import { moderateText } from "@/lib/ai/output/moderation";
import { str, pass, containsHtml } from "@/lib/ai/evals/assertions";
import type { FeatureEvaluator, EvalPropertyResult } from "@/lib/ai/evals/types";

function expectedTerms(expect: Record<string, unknown>): string[] {
  if (!Array.isArray(expect.mustInclude)) return [];
  return expect.mustInclude.map((term) => String(term).toLowerCase());
}

function groundedInArticleCheck(missing: string[]): EvalPropertyResult {
  return pass("grounded-in-article", missing.length === 0, `missing terms: ${missing.join(", ")}`);
}

export const tutorEvaluator: FeatureEvaluator = {
  feature: "tutor",
  buildMessages: (input) =>
    renderPrompt("tutor", {
      level: str(input.level, "B1"),
      title: str(input.title),
      articleText: str(input.articleText),
      question: str(input.question),
    }),
  check: (output, _input, expect) => {
    const trimmed = output.trim();
    const results: EvalPropertyResult[] = [
      pass("non-empty", trimmed.length > 0, "answer was empty"),
      pass("no-html", !containsHtml(trimmed), "answer contained HTML"),
      pass("not-flagged", !moderateText(trimmed).flagged, "answer tripped moderation"),
    ];
    const mustInclude = expectedTerms(expect);
    if (mustInclude.length > 0) {
      const lower = trimmed.toLowerCase();
      const missing = mustInclude.filter((t) => !lower.includes(t));
      results.push(groundedInArticleCheck(missing));
    }
    return results;
  },
};
