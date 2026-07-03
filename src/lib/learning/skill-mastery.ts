/**
 * Skill mastery & CEFR confidence tracking (RW-038).
 *
 * Tracks an internal numeric confidence (0–1) for each of six learning skills —
 * reading, vocabulary, grammar, listening, pronunciation, comprehension — built
 * up from evidence emitted by the various learning activities (quiz, reading,
 * vocabulary lookups/reviews, pronunciation, grammar help). CEFR stays the
 * user-facing output; this is the internal signal behind level recommendations
 * and "weak area" surfacing.
 *
 * Confidence is an exponential moving average of evidence outcomes, so it tracks
 * recent performance while remaining transparent and explainable. The
 * recommendation explicitly lists the per-skill reasons behind it.
 */

import { prisma } from "@/lib/prisma";
import { ENGLISH_LEVELS } from "@/lib/option-registries";
import { getProfile } from "@/lib/profile";
import { clamp01 } from "./primitives";
// Shared types live in ./types so recommendations/ can import them without
// pulling in the full skill-mastery implementation (DB / Prisma deps).
import { SKILLS, isSkill } from "./types";
import type { Skill, EvidenceSummary, SkillSummary, SkillProfile } from "./types";
import { syncCoachMemory } from "./coach-memory";

/** Smoothing factor for the confidence EMA (per unit weight, capped). */
const BASE_ALPHA = 0.3;
const MAX_ALPHA = 0.8;
const MAX_EVIDENCE_WEIGHT = 5;
const DEFAULT_EVIDENCE_WEIGHT = 1;

/** Max recent-evidence summaries retained per skill. */
export const MAX_RECENT_EVIDENCE = 10;

/** Confidence at/above which we consider a skill strong evidence for level-up. */
const UP_THRESHOLD = 0.8;
/** Confidence below which we consider a skill struggling. */
const DOWN_THRESHOLD = 0.4;
/** Minimum skills-with-evidence before a recommendation is trustworthy. */
const MIN_SKILLS_WITH_EVIDENCE = 2;
/** Minimum total evidence items before a recommendation is trustworthy. */
const MIN_TOTAL_EVIDENCE = 4;

export type SkillLevelRecommendation = {
  suggestion: "up" | "down" | "hold";
  currentLevel: string;
  targetLevel: string | null;
  overallConfidence: number;
  reasons: string[];
  skills: SkillSummary[];
  weakest: Skill | null;
  strongest: Skill | null;
};

type SkillMasteryRow = {
  skill: string;
  confidence: number;
  evidenceCount: number;
  recentEvidence: unknown;
};

function evidenceSummaryFromUnknown(item: unknown): EvidenceSummary | null {
  if (
    !item ||
    typeof item !== "object" ||
    typeof (item as EvidenceSummary).outcome !== "number"
  ) {
    return null;
  }

  const evidence = item as EvidenceSummary;
  return {
    outcome: evidence.outcome,
    weight: typeof evidence.weight === "number" ? evidence.weight : DEFAULT_EVIDENCE_WEIGHT,
    at: typeof evidence.at === "string" ? evidence.at : "",
  };
}

function parseRecentEvidence(value: unknown): EvidenceSummary[] {
  let arr: unknown = value;
  if (typeof value === "string") {
    try {
      arr = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: EvidenceSummary[] = [];
  for (const item of arr) {
    const evidence = evidenceSummaryFromUnknown(item);
    if (evidence) out.push(evidence);
  }
  return out;
}

function normalizeEvidenceWeight(weight: number): number {
  return Math.min(
    MAX_EVIDENCE_WEIGHT,
    Math.max(0, Number.isFinite(weight) ? weight : DEFAULT_EVIDENCE_WEIGHT),
  );
}

function nextConfidence(
  existing: SkillMasteryRow | null | undefined,
  outcome: number,
  weight: number,
): number {
  if (!existing) return outcome;
  const alpha = Math.min(MAX_ALPHA, BASE_ALPHA * weight);
  return clamp01(existing.confidence * (1 - alpha) + outcome * alpha);
}

function makeEvidenceSummary(
  outcome: number,
  weight: number,
  at: Date,
): EvidenceSummary {
  return {
    outcome: Math.round(outcome * 100) / 100,
    weight,
    at: at.toISOString(),
  };
}

function prependRecentEvidence(
  existing: unknown,
  evidence: EvidenceSummary,
): EvidenceSummary[] {
  return [evidence, ...parseRecentEvidence(existing)].slice(0, MAX_RECENT_EVIDENCE);
}

/**
 * Records a piece of evidence for a skill. `outcome` is 0–1 (higher = stronger
 * evidence of competence); `weight` scales how strongly this single observation
 * moves the running confidence. The first observation sets the baseline; later
 * ones blend in via an EMA so confidence tracks recent performance.
 */
export async function recordSkillEvidence(
  userId: string,
  skill: Skill,
  outcome: number,
  weight = 1,
): Promise<SkillSummary | null> {
  if (!isSkill(skill)) return null;
  const clampedOutcome = clamp01(outcome);
  const clampedWeight = normalizeEvidenceWeight(weight);

  const existing = await prisma.skillMastery.findUnique({
    where: { userId_skill: { userId, skill } },
  });

  const now = new Date();
  const confidence = nextConfidence(
    existing as SkillMasteryRow | null,
    clampedOutcome,
    clampedWeight,
  );
  const evidenceCount = (existing?.evidenceCount ?? 0) + 1;
  const recentEvidence = prependRecentEvidence(
    existing?.recentEvidence,
    makeEvidenceSummary(clampedOutcome, clampedWeight, now),
  );

  const data = {
    confidence,
    evidenceCount,
    recentEvidence,
    lastUpdatedAt: now,
  };

  const row = await prisma.skillMastery.upsert({
    where: { userId_skill: { userId, skill } },
    create: { userId, skill, ...data },
    update: data,
  });

  // #810 — best-effort, privacy-safe coach-memory side effect. A failure here
  // must never break the mastery write (swallowed + logged inside the helper).
  await syncCoachMemory(userId, skill, row.confidence);

  return {
    skill,
    confidence: row.confidence,
    evidenceCount: row.evidenceCount,
    hasEvidence: row.evidenceCount > 0,
  };
}

function summarizeSkillRows(rows: SkillMasteryRow[]): SkillSummary[] {
  const bySkill = new Map<string, SkillMasteryRow>();
  for (const row of rows) bySkill.set(row.skill, row);

  return SKILLS.map((skill) => {
    const row = bySkill.get(skill);
    const evidenceCount = row?.evidenceCount ?? 0;
    return {
      skill,
      confidence: row?.confidence ?? 0,
      evidenceCount,
      hasEvidence: evidenceCount > 0,
    };
  });
}

function averageConfidence(skills: SkillSummary[]): number {
  return skills.length > 0
    ? skills.reduce((sum, skill) => sum + skill.confidence, 0) / skills.length
    : 0;
}

function countEvidence(skills: SkillSummary[]): number {
  return skills.reduce((sum, skill) => sum + skill.evidenceCount, 0);
}

function findSkillExtremes(skills: SkillSummary[]): {
  weakest: Skill | null;
  strongest: Skill | null;
} {
  let weakest: SkillSummary | null = null;
  let strongest: SkillSummary | null = null;

  for (const skill of skills) {
    if (!weakest || skill.confidence < weakest.confidence) weakest = skill;
    if (!strongest || skill.confidence > strongest.confidence) strongest = skill;
  }

  return {
    weakest: weakest?.skill ?? null,
    strongest: strongest?.skill ?? null,
  };
}

/**
 * Returns a confidence summary across ALL six skills (skills with no evidence
 * yet are reported with confidence 0 and `hasEvidence: false`), plus the
 * overall confidence and the weakest/strongest skills that have evidence.
 */
export async function getSkillProfile(userId: string): Promise<SkillProfile> {
  const rows = (await prisma.skillMastery.findMany({
    where: { userId },
  })) as SkillMasteryRow[];

  const skills = summarizeSkillRows(rows);
  const evidenced = skills.filter((s) => s.hasEvidence);
  const { weakest, strongest } = findSkillExtremes(evidenced);

  return {
    skills,
    overallConfidence: averageConfidence(evidenced),
    totalEvidence: countEvidence(skills),
    weakest,
    strongest,
  };
}

function byName(skills: SkillSummary[], skill: Skill): SkillSummary | undefined {
  return skills.find((s) => s.skill === skill);
}

function pct(value: number): number {
  return Math.round(value * 100);
}

/**
 * Recommends a CEFR level change for the user and EXPLAINS why, from the
 * accumulated skill evidence. Reads the user's current level from their profile
 * (the `Profile.englishLevel` / level-history source of truth) and never
 * mutates state — applying a change always remains an explicit user action.
 *
 * The recommendation is held until there is enough evidence; otherwise it
 * suggests up when overall confidence is high (citing the strong skills) or
 * down when it is low (citing the struggling skills).
 */
export async function recommendLevelChange(
  userId: string,
): Promise<SkillLevelRecommendation> {
  const [profile, skillProfile] = await Promise.all([
    getProfile(userId),
    getSkillProfile(userId),
  ]);

  const currentLevel = profile?.englishLevel ?? ENGLISH_LEVELS[0];
  const currentRank = (ENGLISH_LEVELS as readonly string[]).indexOf(currentLevel);
  const { skills, overallConfidence } = skillProfile;
  const evidenced = skills.filter((s) => s.hasEvidence);

  const base: SkillLevelRecommendation = {
    suggestion: "hold",
    currentLevel,
    targetLevel: null,
    overallConfidence,
    reasons: [],
    skills,
    weakest: skillProfile.weakest,
    strongest: skillProfile.strongest,
  };

  if (!profile) {
    return {
      ...base,
      reasons: ["Complete onboarding to set your level before we recommend changes."],
    };
  }

  if (
    evidenced.length < MIN_SKILLS_WITH_EVIDENCE ||
    skillProfile.totalEvidence < MIN_TOTAL_EVIDENCE
  ) {
    return {
      ...base,
      reasons: [
        "Not enough skill evidence yet to recommend a level change. Keep reading, taking quizzes and practising vocabulary.",
      ],
    };
  }

  const strongSkills = evidenced.filter((s) => s.confidence >= UP_THRESHOLD);
  const weakSkills = evidenced.filter((s) => s.confidence < DOWN_THRESHOLD);

  // ---- Level-UP -----------------------------------------------------------
  if (
    overallConfidence >= UP_THRESHOLD &&
    weakSkills.length === 0 &&
    currentRank >= 0 &&
    currentRank < ENGLISH_LEVELS.length - 1
  ) {
    const targetLevel = ENGLISH_LEVELS[currentRank + 1];
    const reasons = [
      `Overall skill confidence is ${pct(overallConfidence)}% across ${evidenced.length} skills with evidence — you're ready for ${targetLevel}.`,
      ...strongSkills.map(
        (s) => `Strong ${s.skill} (${pct(s.confidence)}% confidence).`,
      ),
    ];
    return { ...base, suggestion: "up", targetLevel, reasons };
  }

  // ---- Level-DOWN ---------------------------------------------------------
  if (overallConfidence < DOWN_THRESHOLD && currentRank > 0) {
    const targetLevel = ENGLISH_LEVELS[currentRank - 1];
    const reasons = [
      `Overall skill confidence is only ${pct(overallConfidence)}% — dropping to ${targetLevel} will help build confidence.`,
      ...weakSkills.map(
        (s) => `Struggling with ${s.skill} (${pct(s.confidence)}% confidence).`,
      ),
    ];
    return { ...base, suggestion: "down", targetLevel, reasons };
  }

  // ---- Hold ---------------------------------------------------------------
  const reasons = [
    `Overall skill confidence is ${pct(overallConfidence)}% — on track for ${currentLevel}.`,
  ];
  if (skillProfile.weakest) {
    const weakest = byName(skills, skillProfile.weakest);
    if (weakest) {
      reasons.push(
        `Focus on ${weakest.skill} (${pct(weakest.confidence)}% confidence) to progress.`,
      );
    }
  }
  return { ...base, reasons };
}
