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

/** Smoothing factor for the confidence EMA (per unit weight, capped). */
const BASE_ALPHA = 0.3;
const MAX_ALPHA = 0.8;

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
    if (
      item &&
      typeof item === "object" &&
      typeof (item as EvidenceSummary).outcome === "number"
    ) {
      const e = item as EvidenceSummary;
      out.push({
        outcome: e.outcome,
        weight: typeof e.weight === "number" ? e.weight : 1,
        at: typeof e.at === "string" ? e.at : "",
      });
    }
  }
  return out;
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
  const clampedWeight = Math.min(5, Math.max(0, Number.isFinite(weight) ? weight : 1));

  const existing = await prisma.skillMastery.findUnique({
    where: { userId_skill: { userId, skill } },
  });

  const now = new Date();
  let confidence: number;
  if (!existing) {
    confidence = clampedOutcome;
  } else {
    const alpha = Math.min(MAX_ALPHA, BASE_ALPHA * clampedWeight);
    confidence = clamp01(existing.confidence * (1 - alpha) + clampedOutcome * alpha);
  }

  const evidenceCount = (existing?.evidenceCount ?? 0) + 1;
  const recent = parseRecentEvidence(existing?.recentEvidence);
  const recentEvidence: EvidenceSummary[] = [
    { outcome: Math.round(clampedOutcome * 100) / 100, weight: clampedWeight, at: now.toISOString() },
    ...recent,
  ].slice(0, MAX_RECENT_EVIDENCE);

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

  return {
    skill,
    confidence: row.confidence,
    evidenceCount: row.evidenceCount,
    hasEvidence: row.evidenceCount > 0,
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

  const bySkill = new Map<string, SkillMasteryRow>();
  for (const row of rows) bySkill.set(row.skill, row);

  const skills: SkillSummary[] = SKILLS.map((skill) => {
    const row = bySkill.get(skill);
    const evidenceCount = row?.evidenceCount ?? 0;
    return {
      skill,
      confidence: row?.confidence ?? 0,
      evidenceCount,
      hasEvidence: evidenceCount > 0,
    };
  });

  const evidenced = skills.filter((s) => s.hasEvidence);
  const overallConfidence =
    evidenced.length > 0
      ? evidenced.reduce((sum, s) => sum + s.confidence, 0) / evidenced.length
      : 0;
  const totalEvidence = skills.reduce((sum, s) => sum + s.evidenceCount, 0);

  let weakest: Skill | null = null;
  let strongest: Skill | null = null;
  for (const s of evidenced) {
    if (weakest === null || s.confidence < (byName(skills, weakest)?.confidence ?? 1)) {
      weakest = s.skill;
    }
    if (strongest === null || s.confidence > (byName(skills, strongest)?.confidence ?? -1)) {
      strongest = s.skill;
    }
  }

  return {
    skills,
    overallConfidence,
    totalEvidence,
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
