/**
 * Study plan types and constants — RW-041.
 *
 * Shared types and exported constants consumed by both the pure
 * diagnosis/synthesis engine ({@link ./study-plan-engine}) and callers.
 */

import type { AdaptiveLevelRecommendation } from "@/lib/leveling";
import type { SkillSummary } from "./skill-mastery";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WeakAreaKind =
  | "vocabulary"
  | "grammar"
  | "reading"
  | "listening"
  | "pronunciation"
  | "comprehension";

export type WeakArea = {
  kind: WeakAreaKind;
  /** 0–1, higher = weaker / more urgent. */
  severity: number;
  label: string;
  /** One-line, numbers-grounded summary of the weakness. */
  detail: string;
  /** Supporting evidence bullet points. */
  evidence: string[];
};

export type StudyPlanItem = {
  /** Stable key for React lists / dedupe. */
  id: string;
  kind: WeakAreaKind | "reading-rec" | "general";
  title: string;
  description: string;
  href: string;
  cta: string;
};

export type StudyPlan = {
  generatedAt: string; // ISO
  summary: string;
  weakAreas: WeakArea[];
  items: StudyPlanItem[];
  /** True when evidence is too thin to diagnose — a starter plan is returned. */
  isStarter: boolean;
};

/** A single top reading recommendation surfaced into the plan (from RW-039). */
export type StudyReadingRec = {
  id: string;
  title: string;
  reason: string;
};

/** Deterministic snapshot the pure diagnosis/plan functions operate on. */
export type StudyDiagnostics = {
  skills: SkillSummary[];
  hasSkillEvidence: boolean;
  vocab: {
    weakCount: number; // saved words with familiarity < 0.4
    dueCount: number; // flashcards due for review
    totalSaved: number;
  };
  quiz: {
    averageScore: number | null; // 0–100
    totalAttempts: number;
  };
  comprehension: {
    lowCount: number; // articles with comprehensionScore < 0.5
    assessedCount: number; // articles with any mastery row
  };
  pronunciation: {
    avgScore: number | null; // 0–100
    attempts: number;
  };
  level: AdaptiveLevelRecommendation | null;
  readingRec: StudyReadingRec | null;
};

// ---------------------------------------------------------------------------
// Exported thresholds (used by callers and tests)
// ---------------------------------------------------------------------------

/** Familiarity below this marks a saved word as "weak". */
export const WEAK_WORD_FAMILIARITY = 0.4;
/** Comprehension score below this marks an article as poorly understood. */
export const LOW_COMPREHENSION = 0.5;

// ---------------------------------------------------------------------------
// Pure plan-item helpers (used by buildWeeklyPlan in study-plan-engine)
// ---------------------------------------------------------------------------

/** Maps a reading recommendation into a study plan item. */
export function readingRecItem(rec: StudyReadingRec): StudyPlanItem {
  return {
    id: `reading-rec:${rec.id}`,
    kind: "reading-rec",
    title: `Read: ${rec.title}`,
    description: rec.reason,
    href: `/reader/${rec.id}`,
    cta: "Start reading",
  };
}

/** Maps a weak area to an actionable study plan item. Pure. */
export function planItemForArea(area: WeakArea, diag: StudyDiagnostics): StudyPlanItem | null {
  switch (area.kind) {
    case "vocabulary":
      return diag.vocab.dueCount > 0
        ? {
            id: "vocabulary:review",
            kind: "vocabulary",
            title: `Review ${diag.vocab.dueCount} due flashcard(s)`,
            description: "Spaced-repetition review strengthens the words you're forgetting.",
            href: "/study",
            cta: "Review now",
          }
        : {
            id: "vocabulary:practise",
            kind: "vocabulary",
            title: "Practise your weak vocabulary",
            description: `Work through cloze drills for ${diag.vocab.weakCount} word(s) you don't know well yet.`,
            href: "/study/words",
            cta: "Practise words",
          };
    case "comprehension":
      return {
        id: "comprehension:quiz",
        kind: "comprehension",
        title: "Read then take the comprehension quiz",
        description: "Quizzing after reading is the strongest way to lift comprehension.",
        href: "/browse?view=picks",
        cta: "Find an article",
      };
    case "reading":
      return {
        id: "reading:ease",
        kind: "reading",
        title: `Switch to ${diag.level?.recommendedLevel ?? "easier"} articles`,
        description:
          diag.level?.explanation.join(" ") ??
          "Reading at a comfortable level builds fluency faster.",
        href: `/browse?view=picks${diag.level ? `&level=${diag.level.recommendedLevel}` : ""}`,
        cta: "See easier picks",
      };
    case "pronunciation":
      return {
        id: "pronunciation:practise",
        kind: "pronunciation",
        title: "Practise pronunciation aloud",
        description: "Read a passage aloud and check your pronunciation score in the reader.",
        href: diag.readingRec ? `/reader/${diag.readingRec.id}` : "/browse?view=picks",
        cta: "Practise speaking",
      };
    case "listening":
      return {
        id: "listening:narration",
        kind: "listening",
        title: "Listen to an article narration",
        description: "Follow along with the audio narration to train your listening ear.",
        href: diag.readingRec ? `/reader/${diag.readingRec.id}` : "/browse?view=picks",
        cta: "Listen now",
      };
    case "grammar":
      return {
        id: "grammar:explain",
        kind: "grammar",
        title: "Study grammar in context",
        description: "Tap tricky sentences in the reader for an instant grammar explanation.",
        href: diag.readingRec ? `/reader/${diag.readingRec.id}` : "/browse?view=picks",
        cta: "Read with grammar help",
      };
    default:
      return null;
  }
}
