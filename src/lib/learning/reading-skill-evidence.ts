/**
 * Reading-skill evidence from graded quiz answers (#1302).
 *
 * Feeds per-question outcomes into the learner model without storing content:
 * vocabulary-in-context answers become `vocabulary` Skill Mastery evidence,
 * and main-idea / inferential answers update the coach-memory `main_idea` and
 * `inference` dimensions with the attempt's correct ratio. Best-effort — never
 * breaks the attempt write.
 */
import { recordLearnerEvidence } from "./learner-evidence";
import { syncCoachMemory } from "./coach-memory";
import type { ReadingSkill } from "./reading-skills";

type CoachReadingDimension = "main_idea" | "inference";

/** Coach-memory dimension each reading skill informs (evidence/detail informs none). */
export const COACH_DIMENSION_BY_SKILL: Partial<Record<ReadingSkill, CoachReadingDimension>> = {
  main_idea: "main_idea",
  cause_effect: "inference",
  point_of_view: "inference",
  argument: "inference",
};

function ratio(answers: Array<{ correct: boolean }>): number {
  return answers.filter((answer) => answer.correct).length / answers.length;
}

export async function recordReadingSkillEvidence(
  userId: string,
  answers: ReadonlyArray<{ skillTag: ReadingSkill; correct: boolean }>,
): Promise<void> {
  const vocabulary = answers.filter((answer) => answer.skillTag === "vocabulary_in_context");
  const byDimension = new Map<CoachReadingDimension, Array<{ correct: boolean }>>();
  for (const answer of answers) {
    const dimension = COACH_DIMENSION_BY_SKILL[answer.skillTag];
    if (!dimension) continue;
    byDimension.set(dimension, [...(byDimension.get(dimension) ?? []), answer]);
  }

  await Promise.all([
    vocabulary.length > 0
      ? recordLearnerEvidence(userId, {
          activity: "quiz-vocabulary-in-context",
          correct: vocabulary.filter((answer) => answer.correct).length,
          total: vocabulary.length,
        })
      : Promise.resolve(),
    ...[...byDimension].map(([dimension, outcomes]) => syncCoachMemory(userId, dimension, ratio(outcomes))),
  ]);
}
