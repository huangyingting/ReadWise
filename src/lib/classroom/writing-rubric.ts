/**
 * Client-safe Write Prompt constants (#1305): rubric dimensions, statuses,
 * limits, the generic prompt, and word counting. Shared by the reader Write
 * panel, the teacher review UI, and the server commands in `./writing`.
 */

export const WRITE_RUBRIC = [
  { key: "claim", label: "Claim & focus" },
  { key: "evidence", label: "Textual evidence" },
  { key: "organization", label: "Organization" },
  { key: "language", label: "Language & conventions" },
] as const;

export type RubricDimension = (typeof WRITE_RUBRIC)[number]["key"];
export type RubricScores = Partial<Record<RubricDimension, number>>;

export const RUBRIC_MIN_SCORE = 1;
export const RUBRIC_MAX_SCORE = 4;
export const WRITE_BODY_MAX_LENGTH = 20_000;
export const WRITE_PROMPT_MAX_LENGTH = 1_000;

/** `scopeKey` for personal writing that isn't tied to an assignment. */
export const INDEPENDENT_WRITE_SCOPE = "independent";

export const WRITE_STATUS_LABELS = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  NEEDS_REVISION: "Needs revision",
  GRADED: "Graded",
} as const;

export type WriteStatus = keyof typeof WRITE_STATUS_LABELS;

/** The prompt used when neither the assignment nor the article sets one. */
export function defaultWritePrompt(articleTitle: string): string {
  return (
    `What is the most important idea in “${articleTitle}”? Explain it in your own words ` +
    "and support your answer with at least two details from the article."
  );
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Keeps known dimensions with whole scores in range; drops everything else. */
export function sanitizeRubricScores(value: unknown): RubricScores {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const scores: RubricScores = {};
  for (const { key } of WRITE_RUBRIC) {
    const score = (value as Record<string, unknown>)[key];
    if (Number.isInteger(score) && (score as number) >= RUBRIC_MIN_SCORE && (score as number) <= RUBRIC_MAX_SCORE) {
      scores[key] = score as number;
    }
  }
  return scores;
}

/** Sum of the scored dimensions and the maximum possible for the full rubric. */
export function rubricTotal(scores: RubricScores): { total: number; max: number } {
  return {
    total: Object.values(scores).reduce((sum, score) => sum + (score ?? 0), 0),
    max: WRITE_RUBRIC.length * RUBRIC_MAX_SCORE,
  };
}
