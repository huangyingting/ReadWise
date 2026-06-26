/**
 * Study plan engine — RW-041.
 *
 * Pure diagnosis ({@link diagnoseWeakAreas}), plan synthesis
 * ({@link buildWeeklyPlan}), DB gathering ({@link gatherStudyDiagnostics}),
 * and the top-level entry point ({@link generateStudyPlan}).
 *
 * Types and exported constants live in {@link ./study-plan-types}.
 */

import { prisma } from "@/lib/prisma";
import { clamp01 } from "./primitives";
import { getSkillProfile } from "./skill-mastery";
import { SKILLS, type Skill, type SkillSummary } from "./types";
import {
  getAdaptiveLevelRecommendation,
} from "@/lib/leveling";
import {
  WEAK_WORD_FAMILIARITY,
  LOW_COMPREHENSION,
  readingRecItem,
  planItemForArea,
  type WeakAreaKind,
  type WeakArea,
  type StudyPlanItem,
  type StudyPlan,
  type StudyReadingRec,
  type StudyDiagnostics,
} from "./study-plan-types";

export { SKILLS };

// ---------------------------------------------------------------------------
// Internal thresholds
// ---------------------------------------------------------------------------

/** Skill confidence below this is treated as a weak area (when evidenced). */
const WEAK_SKILL_CONFIDENCE = 0.5;
/** Quiz average below this contributes to comprehension weakness. */
const WEAK_QUIZ_AVERAGE = 70;
/** Pronunciation score below this is treated as a weak area. */
const WEAK_PRON_SCORE = 70;
/** Maximum plan items returned (keeps the weekly plan focused). */
const MAX_PLAN_ITEMS = 6;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function skillConfidence(skills: SkillSummary[], skill: Skill): SkillSummary | undefined {
  return skills.find((s) => s.skill === skill);
}

const SKILL_LABEL: Record<WeakAreaKind, string> = {
  vocabulary: "Vocabulary",
  grammar: "Grammar",
  reading: "Reading level",
  listening: "Listening",
  pronunciation: "Pronunciation",
  comprehension: "Comprehension",
};

/**
 * Derives the ordered list of weak areas from a diagnostics snapshot. PURE.
 * Only dimensions with actual supporting evidence are included, so the result
 * is grounded — never generic. Sorted by severity (weakest first).
 */
export function diagnoseWeakAreas(diag: StudyDiagnostics): WeakArea[] {
  const areas: WeakArea[] = [];

  // ---- Vocabulary -------------------------------------------------------
  {
    const vocabSkill = skillConfidence(diag.skills, "vocabulary");
    const ratio =
      diag.vocab.totalSaved > 0 ? diag.vocab.weakCount / diag.vocab.totalSaved : 0;
    const fromSkill =
      vocabSkill?.hasEvidence && vocabSkill.confidence < WEAK_SKILL_CONFIDENCE
        ? 1 - vocabSkill.confidence
        : 0;
    const severity = clamp01(Math.max(ratio, fromSkill, diag.vocab.dueCount > 0 ? 0.4 : 0));
    if (diag.vocab.weakCount > 0 || diag.vocab.dueCount > 0 || fromSkill > 0) {
      const evidence: string[] = [];
      if (diag.vocab.weakCount > 0)
        evidence.push(`${diag.vocab.weakCount} saved word(s) below ${Math.round(WEAK_WORD_FAMILIARITY * 100)}% familiarity`);
      if (diag.vocab.dueCount > 0)
        evidence.push(`${diag.vocab.dueCount} flashcard(s) due for review`);
      if (fromSkill > 0 && vocabSkill)
        evidence.push(`Vocabulary skill confidence ${Math.round(vocabSkill.confidence * 100)}%`);
      areas.push({
        kind: "vocabulary",
        severity,
        label: SKILL_LABEL.vocabulary,
        detail: `You have ${diag.vocab.weakCount} weak word(s) and ${diag.vocab.dueCount} due for review.`,
        evidence,
      });
    }
  }

  // ---- Comprehension ----------------------------------------------------
  {
    const compSkill = skillConfidence(diag.skills, "comprehension");
    const lowRatio =
      diag.comprehension.assessedCount > 0
        ? diag.comprehension.lowCount / diag.comprehension.assessedCount
        : 0;
    const quizGap =
      diag.quiz.averageScore != null && diag.quiz.averageScore < WEAK_QUIZ_AVERAGE
        ? (WEAK_QUIZ_AVERAGE - diag.quiz.averageScore) / WEAK_QUIZ_AVERAGE
        : 0;
    const fromSkill =
      compSkill?.hasEvidence && compSkill.confidence < WEAK_SKILL_CONFIDENCE
        ? 1 - compSkill.confidence
        : 0;
    const severity = clamp01(Math.max(lowRatio, quizGap, fromSkill));
    if (
      (diag.comprehension.assessedCount > 0 && diag.comprehension.lowCount > 0) ||
      quizGap > 0 ||
      fromSkill > 0
    ) {
      const evidence: string[] = [];
      if (diag.comprehension.lowCount > 0)
        evidence.push(`${diag.comprehension.lowCount} article(s) understood below ${Math.round(LOW_COMPREHENSION * 100)}%`);
      if (diag.quiz.averageScore != null && diag.quiz.totalAttempts > 0)
        evidence.push(`Quiz average ${Math.round(diag.quiz.averageScore)}% across ${diag.quiz.totalAttempts} attempt(s)`);
      areas.push({
        kind: "comprehension",
        severity,
        label: SKILL_LABEL.comprehension,
        detail:
          diag.quiz.averageScore != null
            ? `Your quiz average is ${Math.round(diag.quiz.averageScore)}% — comprehension needs attention.`
            : `Several articles were understood below ${Math.round(LOW_COMPREHENSION * 100)}%.`,
        evidence,
      });
    }
  }

  // ---- Reading level ----------------------------------------------------
  if (diag.level && diag.level.suggestion === "down") {
    areas.push({
      kind: "reading",
      severity: clamp01(0.5 + 0.5 * diag.level.confidence),
      label: SKILL_LABEL.reading,
      detail: `Recent articles look too hard — easing toward ${diag.level.recommendedLevel}.`,
      evidence: diag.level.explanation,
    });
  }

  // ---- Pronunciation ----------------------------------------------------
  {
    const pronSkill = skillConfidence(diag.skills, "pronunciation");
    const fromScore =
      diag.pronunciation.avgScore != null && diag.pronunciation.avgScore < WEAK_PRON_SCORE
        ? (WEAK_PRON_SCORE - diag.pronunciation.avgScore) / WEAK_PRON_SCORE
        : 0;
    const fromSkill =
      pronSkill?.hasEvidence && pronSkill.confidence < WEAK_SKILL_CONFIDENCE
        ? 1 - pronSkill.confidence
        : 0;
    const severity = clamp01(Math.max(fromScore, fromSkill));
    if (fromScore > 0 || fromSkill > 0) {
      const evidence: string[] = [];
      if (diag.pronunciation.avgScore != null && diag.pronunciation.attempts > 0)
        evidence.push(`Pronunciation average ${Math.round(diag.pronunciation.avgScore)}% across ${diag.pronunciation.attempts} attempt(s)`);
      if (fromSkill > 0 && pronSkill)
        evidence.push(`Pronunciation skill confidence ${Math.round(pronSkill.confidence * 100)}%`);
      areas.push({
        kind: "pronunciation",
        severity,
        label: SKILL_LABEL.pronunciation,
        detail: "Your pronunciation scores have room to improve.",
        evidence,
      });
    }
  }

  // ---- Listening & grammar (skill-mastery driven) -----------------------
  for (const kind of ["listening", "grammar"] as const) {
    const skill = skillConfidence(diag.skills, kind);
    if (skill?.hasEvidence && skill.confidence < WEAK_SKILL_CONFIDENCE) {
      areas.push({
        kind,
        severity: clamp01(1 - skill.confidence),
        label: SKILL_LABEL[kind],
        detail: `Your ${kind} confidence is ${Math.round(skill.confidence * 100)}%.`,
        evidence: [`${kind} skill confidence ${Math.round(skill.confidence * 100)}%`],
      });
    }
  }

  return areas.sort((a, b) => b.severity - a.severity);
}

// ---------------------------------------------------------------------------
// Plan synthesis
// ---------------------------------------------------------------------------

/**
 * Synthesises the weekly plan from diagnosed weak areas. PURE. Always finishes
 * with a level-appropriate reading recommendation (reused from RW-039) so there
 * is a concrete next read. When there are no weak areas, returns a STARTER plan.
 */
export function buildWeeklyPlan(
  weakAreas: WeakArea[],
  diag: StudyDiagnostics,
): StudyPlanItem[] {
  const items: StudyPlanItem[] = [];
  const seen = new Set<string>();

  for (const area of weakAreas) {
    const item = planItemForArea(area, diag);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
    if (items.length >= MAX_PLAN_ITEMS - 1) break;
  }

  // Starter plan when there's nothing to diagnose yet.
  if (items.length === 0) {
    if (diag.vocab.dueCount > 0) {
      items.push({
        id: "starter:review",
        kind: "vocabulary",
        title: `Review ${diag.vocab.dueCount} due flashcard(s)`,
        description: "Keep your saved words fresh with a quick review.",
        href: "/study",
        cta: "Review now",
      });
    }
    items.push({
      id: "starter:read",
      kind: "general",
      title: "Read a level-appropriate article",
      description: "Reading regularly is the foundation — pick one from your personalized list.",
      href: "/browse?view=picks",
      cta: "Browse picks",
    });
    items.push({
      id: "starter:quiz",
      kind: "comprehension",
      title: "Take a comprehension quiz",
      description: "After reading, test yourself to start tracking your progress.",
      href: "/browse?view=picks",
      cta: "Find an article",
    });
  }

  if (diag.readingRec && !seen.has(`reading-rec:${diag.readingRec.id}`) && items.length < MAX_PLAN_ITEMS) {
    items.push(readingRecItem(diag.readingRec));
  }

  return items.slice(0, MAX_PLAN_ITEMS);
}

// ---------------------------------------------------------------------------
// DB gathering + public entry point
// ---------------------------------------------------------------------------

/** Gathers all study diagnostics for a user from recorded activity. */
export async function gatherStudyDiagnostics(
  userId: string,
  getArticleRecommendations: () => Promise<StudyReadingRec | null> = async () => null,
): Promise<StudyDiagnostics> {
  const now = new Date();
  const [
    skillProfile,
    level,
    weakCount,
    dueCount,
    totalSaved,
    lowCount,
    assessedCount,
    quizAgg,
    pronAgg,
  ] = await Promise.all([
    getSkillProfile(userId),
    getAdaptiveLevelRecommendation(userId),
    prisma.wordMastery.count({
      where: { userId, familiarity: { lt: WEAK_WORD_FAMILIARITY } },
    }),
    prisma.savedWord.count({
      where: { userId, OR: [{ dueAt: null }, { dueAt: { lte: now } }] },
    }),
    prisma.savedWord.count({ where: { userId } }),
    prisma.articleMastery.count({
      where: { userId, comprehensionScore: { lt: LOW_COMPREHENSION } },
    }),
    prisma.articleMastery.count({ where: { userId } }),
    prisma.quizAttempt.aggregate({
      where: { userId },
      _avg: { scorePct: true },
      _count: { _all: true },
    }),
    prisma.pronunciationAttempt.aggregate({
      where: { userId },
      _avg: { pronScore: true },
      _count: { _all: true },
    }),
  ]);

  const readingRec = await getArticleRecommendations();

  return {
    skills: skillProfile.skills,
    hasSkillEvidence: skillProfile.totalEvidence > 0,
    vocab: { weakCount, dueCount, totalSaved },
    quiz: {
      averageScore: quizAgg._count._all > 0 ? quizAgg._avg.scorePct ?? null : null,
      totalAttempts: quizAgg._count._all,
    },
    comprehension: { lowCount, assessedCount },
    pronunciation: {
      avgScore: pronAgg._count._all > 0 ? pronAgg._avg.pronScore ?? null : null,
      attempts: pronAgg._count._all,
    },
    level,
    readingRec,
  };
}

function summarize(weakAreas: WeakArea[], isStarter: boolean): string {
  if (isStarter) {
    return "Start building your learning history — here's a plan to get going this week.";
  }
  const top = weakAreas.slice(0, 2).map((a) => a.label.toLowerCase());
  if (top.length === 1) return `This week, focus on ${top[0]}.`;
  return `This week, focus on ${top[0]} and ${top[1]}.`;
}

/**
 * Computes the learner's weak areas and weekly study plan ON THE FLY from
 * current activity (no persistence). Recomputed each call, so the plan updates
 * as the learner practises. Always returns a usable plan — a STARTER plan for
 * new users with thin data.
 */
export async function generateStudyPlan(userId: string): Promise<StudyPlan> {
  // Dynamic import avoids a static learning ↔ recommendations cycle while still
  // wiring the article-recommendation step as the default implementation.
  const { listScoredPicksPage } = await import("@/lib/recommendations/picks");
  const diag = await gatherStudyDiagnostics(userId, async () => {
    const picks = await listScoredPicksPage(userId, { limit: 1 });
    const topPick = picks.articles[0] ?? null;
    return topPick
      ? { id: topPick.id, title: topPick.title, reason: picks.reasons[topPick.id] ?? "Recommended for you" }
      : null;
  });
  const weakAreas = diagnoseWeakAreas(diag);
  const items = buildWeeklyPlan(weakAreas, diag);
  const isStarter = weakAreas.length === 0;
  return {
    generatedAt: new Date().toISOString(),
    summary: summarize(weakAreas, isStarter),
    weakAreas,
    items,
    isStarter,
  };
}
