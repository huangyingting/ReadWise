/**
 * Activity-shaped Skill Mastery evidence policy.
 *
 * Callers report controlled activity outcomes after the primary write succeeds.
 * This module owns score normalization, skill mapping, evidence weights, and
 * best-effort failure handling. It never accepts learner content.
 */

import { bestEffortMastery } from "./primitives";
import { recordSkillEvidence } from "./skill-mastery";
import type { Skill } from "./types";

type FlashcardGrade = "again" | "hard" | "good" | "easy";
type ComprehensionSelfRating = "confident" | "partial" | "confused";
type ComprehensionSkillTag =
  | "main_idea"
  | "detail"
  | "inference"
  | "vocabulary_in_context";

export type LearnerEvidence =
  | { activity: "reading-progress"; percent: number }
  | { activity: "quiz-completed"; scorePct: number }
  | {
      activity: "pronunciation-attempt";
      pronunciationScore: number;
      accuracyScore: number;
    }
  | { activity: "grammar-help-used" }
  | { activity: "flashcard-reviewed"; grade: FlashcardGrade }
  | {
      activity: "today-comprehension";
      selfRating: ComprehensionSelfRating;
      mcqCorrect: boolean | null;
      skillTag: ComprehensionSkillTag | null;
    };

type SkillEvidence = {
  label: string;
  skill: Skill;
  outcome: number;
  weight?: number;
};

const FLASHCARD_OUTCOME: Record<FlashcardGrade, number> = {
  again: 0,
  hard: 0.35,
  good: 0.75,
  easy: 1,
};

const SELF_RATING_OUTCOME: Record<ComprehensionSelfRating, number> = {
  confident: 0.9,
  partial: 0.6,
  confused: 0.3,
};

function todayComprehensionSkill(tag: ComprehensionSkillTag | null): Skill {
  return tag === "vocabulary_in_context" ? "vocabulary" : "comprehension";
}

function evidenceFor(activity: LearnerEvidence): SkillEvidence[] {
  switch (activity.activity) {
    case "reading-progress":
      return [{
        label: "progress.reading_skill",
        skill: "reading",
        outcome: activity.percent / 100,
        weight: 0.5,
      }];
    case "quiz-completed": {
      const outcome = activity.scorePct / 100;
      return [
        { label: "quiz.comprehension_skill", skill: "comprehension", outcome },
        { label: "quiz.reading_skill", skill: "reading", outcome, weight: 0.5 },
      ];
    }
    case "pronunciation-attempt":
      return [
        {
          label: "pronunciation.skill",
          skill: "pronunciation",
          outcome: activity.pronunciationScore / 100,
        },
        {
          label: "pronunciation.listening_skill",
          skill: "listening",
          outcome: activity.accuracyScore / 100,
          weight: 0.5,
        },
      ];
    case "grammar-help-used":
      return [{ label: "grammar.skill", skill: "grammar", outcome: 0.5, weight: 0.3 }];
    case "flashcard-reviewed":
      return [{
        label: "flashcard.vocabulary_skill",
        skill: "vocabulary",
        outcome: FLASHCARD_OUTCOME[activity.grade],
      }];
    case "today-comprehension": {
      const evidence: SkillEvidence[] = [{
        label: "today.comprehension_self_rating_skill",
        skill: "comprehension",
        outcome: SELF_RATING_OUTCOME[activity.selfRating],
        weight: 0.5,
      }];
      if (activity.mcqCorrect !== null) {
        evidence.push({
          label: "today.comprehension_mcq_skill",
          skill: todayComprehensionSkill(activity.skillTag),
          outcome: activity.mcqCorrect ? 1 : 0,
        });
      }
      return evidence;
    }
  }
}

/** Records every Skill Mastery signal for one completed learner activity. */
export async function recordLearnerEvidence(
  userId: string,
  activity: LearnerEvidence,
): Promise<void> {
  await Promise.all(
    evidenceFor(activity).map((evidence) =>
      bestEffortMastery(evidence.label, () =>
        recordSkillEvidence(
          userId,
          evidence.skill,
          evidence.outcome,
          evidence.weight,
        ),
      ),
    ),
  );
}