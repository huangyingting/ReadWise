/**
 * Shared learning domain types — extracted from skill-mastery.ts so that
 * `recommendations/` can import just the type contract without pulling in the
 * full skill-mastery implementation (which has DB / Prisma dependencies).
 */

/** The six tracked skill dimensions. */
export const SKILLS = [
  "reading",
  "vocabulary",
  "grammar",
  "listening",
  "pronunciation",
  "comprehension",
] as const;

export type Skill = (typeof SKILLS)[number];

export function isSkill(value: unknown): value is Skill {
  return typeof value === "string" && (SKILLS as readonly string[]).includes(value);
}

export type EvidenceSummary = {
  outcome: number; // 0–1
  weight: number;
  at: string; // ISO timestamp
};

export type SkillSummary = {
  skill: Skill;
  confidence: number; // 0–1
  evidenceCount: number;
  hasEvidence: boolean;
};

export type SkillProfile = {
  skills: SkillSummary[];
  overallConfidence: number; // 0–1, mean of skills that have evidence
  totalEvidence: number;
  weakest: Skill | null; // lowest-confidence skill that has evidence
  strongest: Skill | null; // highest-confidence skill that has evidence
};
