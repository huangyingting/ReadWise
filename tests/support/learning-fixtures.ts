/**
 * Shared fixture builders for learning-domain unit tests.
 *
 * Centralises the verbatim copies that previously lived in
 * leveling-adaptive.test.ts, study-plan.test.ts, and recommendations.test.ts.
 *
 * Exported builders:
 *   makeLevelEvidence        — LevelEvidence (leveling-adaptive tests)
 *   makeStudyDiagnostics     — StudyDiagnostics (study-plan tests)
 *   makeRecommendationCandidate — RecommendationCandidate (recommendations tests)
 *   makeRecommendationContext   — RecommendationContext (recommendations tests)
 */

import type { LevelEvidence } from "@/lib/leveling";
import type { StudyDiagnostics } from "@/lib/learning/study-plan";
import type { SkillSummary, Skill } from "@/lib/learning/types";
import type { RecommendationCandidate, RecommendationContext } from "@/lib/recommendations/types";

// ---------------------------------------------------------------------------
// Leveling fixtures
// ---------------------------------------------------------------------------

export function makeLevelEvidence(partial: Partial<LevelEvidence> = {}): LevelEvidence {
  return {
    currentLevel: "B1",
    feedback: { too_easy: 0, just_right: 0, too_hard: 0 },
    avgQuizScore: null,
    quizAttemptCount: 0,
    completedAtLevel: 0,
    skillConfidence: null,
    skillEvidenceCount: 0,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Study-plan fixtures
// ---------------------------------------------------------------------------

const SKILL_LIST: Skill[] = [
  "reading",
  "vocabulary",
  "grammar",
  "listening",
  "pronunciation",
  "comprehension",
];

/** Build a full set of SkillSummary rows with optional per-skill overrides. */
export function makeSkillSummaries(
  overrides: Partial<Record<Skill, Partial<SkillSummary>>> = {},
): SkillSummary[] {
  return SKILL_LIST.map((skill) => ({
    skill,
    confidence: 0.7,
    evidenceCount: 0,
    hasEvidence: false,
    ...overrides[skill],
  }));
}

export function makeStudyDiagnostics(partial: Partial<StudyDiagnostics> = {}): StudyDiagnostics {
  return {
    skills: makeSkillSummaries(),
    hasSkillEvidence: false,
    vocab: { weakCount: 0, dueCount: 0, totalSaved: 0 },
    quiz: { averageScore: null, totalAttempts: 0 },
    comprehension: { lowCount: 0, assessedCount: 0 },
    pronunciation: { avgScore: null, attempts: 0 },
    level: null,
    readingRec: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Recommendation fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-23T00:00:00Z");

export function makeRecommendationCandidate(
  partial: Partial<RecommendationCandidate> & { id: string },
): RecommendationCandidate {
  return {
    title: `Title ${partial.id}`,
    author: "Author",
    source: "Source",
    category: null,
    difficulty: null,
    readingMinutes: 5,
    wordCount: 600,
    publishedAt: NOW,
    heroImage: null,
    tagSlugs: [],
    ...partial,
  } as RecommendationCandidate;
}

export function makeRecommendationContext(
  partial: Partial<RecommendationContext> = {},
): RecommendationContext {
  return {
    userLevel: null,
    userLevelRank: null,
    topicSet: new Set<string>(),
    completedIds: new Set<string>(),
    inProgressPercent: new Map<string, number>(),
    masteryByArticle: new Map(),
    difficultyBias: 0,
    weakestSkill: null,
    vocab: { avgFamiliarity: 0, knownCount: 0 },
    now: NOW,
    ...partial,
  };
}
