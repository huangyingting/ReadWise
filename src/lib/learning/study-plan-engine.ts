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
import { lemmaFor } from "@/lib/lexical/normalize";
import { clamp01, WEAK_SAVED_WORD_FAMILIARITY } from "./primitives";
import { getSkillProfile } from "./skill-mastery";
import { coachMemorySkillConfidences } from "./coach-memory";
import { SKILLS, type Skill, type SkillSummary } from "./types";
import {
  getAdaptiveLevelRecommendation,
} from "@/lib/leveling";
import {
  LOW_COMPREHENSION,
  readingRecItem,
  planItemForArea,
  type WeakAreaKind,
  type WeakArea,
  type StudyPlanItem,
  type StudyPlan,
  type StudyPlanHistoryEntry,
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
const STUDY_PLAN_SOURCE_VERSION = "study-plan-v1";
const DEFAULT_HISTORY_LIMIT = 8;
const MAX_HISTORY_LIMIT = 52;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function skillConfidence(skills: SkillSummary[], skill: Skill): SkillSummary | undefined {
  return skills.find((s) => s.skill === skill);
}

function confidenceGap(skill: SkillSummary | undefined): number {
  return skill?.hasEvidence && skill.confidence < WEAK_SKILL_CONFIDENCE
    ? 1 - skill.confidence
    : 0;
}

function confidenceEvidence(label: string, skill: SkillSummary | undefined): string | null {
  return skill ? `${label} skill confidence ${Math.round(skill.confidence * 100)}%` : null;
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
    const fromSkill = confidenceGap(vocabSkill);
    const severity = clamp01(Math.max(ratio, fromSkill, diag.vocab.dueCount > 0 ? 0.4 : 0));
    if (diag.vocab.weakCount > 0 || diag.vocab.dueCount > 0 || fromSkill > 0) {
      const evidence: string[] = [];
      if (diag.vocab.weakCount > 0)
        evidence.push(`${diag.vocab.weakCount} saved word(s) below ${Math.round(WEAK_SAVED_WORD_FAMILIARITY * 100)}% familiarity`);
      if (diag.vocab.dueCount > 0)
        evidence.push(`${diag.vocab.dueCount} flashcard(s) due for review`);
      const skillEvidence = fromSkill > 0 ? confidenceEvidence("Vocabulary", vocabSkill) : null;
      if (skillEvidence) evidence.push(skillEvidence);
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
    const fromSkill = confidenceGap(compSkill);
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
    const fromSkill = confidenceGap(pronSkill);
    const severity = clamp01(Math.max(fromScore, fromSkill));
    if (fromScore > 0 || fromSkill > 0) {
      const evidence: string[] = [];
      if (diag.pronunciation.avgScore != null && diag.pronunciation.attempts > 0)
        evidence.push(`Pronunciation average ${Math.round(diag.pronunciation.avgScore)}% across ${diag.pronunciation.attempts} attempt(s)`);
      const skillEvidence = fromSkill > 0 ? confidenceEvidence("Pronunciation", pronSkill) : null;
      if (skillEvidence) evidence.push(skillEvidence);
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
    const severity = confidenceGap(skill);
    if (severity > 0 && skill) {
      areas.push({
        kind,
        severity: clamp01(severity),
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

function applyCoachMemoryToSkills(
  skillProfile: { skills: SkillSummary[] },
  coachConfidences: ReadonlyMap<string, number>,
): SkillSummary[] {
  if (coachConfidences.size === 0) {
    return skillProfile.skills;
  }

  return skillProfile.skills.map((s) => {
    const coachConfidence = coachConfidences.get(s.skill);
    return coachConfidence === undefined
      ? s
      : { ...s, confidence: coachConfidence, hasEvidence: true };
  });
}

function readingRecFromTopPick(
  topPick: { id: string; title: string } | null,
  reasons: Record<string, string>,
): StudyReadingRec | null {
  return topPick
    ? { id: topPick.id, title: topPick.title, reason: reasons[topPick.id] ?? "Recommended for you" }
    : null;
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
    coachConfidences,
    level,
    savedWordsForWeakness,
    weakWordRows,
    dueCount,
    lowCount,
    assessedCount,
    quizAgg,
    pronAgg,
  ] = await Promise.all([
    getSkillProfile(userId),
    coachMemorySkillConfidences(userId, now),
    getAdaptiveLevelRecommendation(userId),
    prisma.savedWord.findMany({
      where: { userId },
      select: { word: true },
    }),
    prisma.wordMastery.findMany({
      where: { userId, familiarity: { lt: WEAK_SAVED_WORD_FAMILIARITY } },
      select: { lemma: true },
    }),
    prisma.savedWord.count({
      where: { userId, OR: [{ dueAt: null }, { dueAt: { lte: now } }] },
    }),
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

  // #810 — coach memory informs skill ranking by recency trend, not just the
  // latest snapshot. When memory is empty (cold start), fall back to
  // SkillMastery so existing behaviour is unchanged.
  const skills = applyCoachMemoryToSkills(skillProfile, coachConfidences);
  const totalSaved = savedWordsForWeakness.length;
  const weakCount = countWeakSavedWords(
    savedWordsForWeakness as SavedWordForWeakness[],
    weakWordRows as WeakWordMasteryRow[],
  );

  return {
    skills,
    hasSkillEvidence: skillProfile.totalEvidence > 0 || coachConfidences.size > 0,
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

function startOfUtcWeek(date: Date): Date {
  const out = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = out.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  out.setUTCDate(out.getUTCDate() - daysSinceMonday);
  return out;
}

function endOfUtcWeek(weekStart: Date): Date {
  const out = new Date(weekStart);
  out.setUTCDate(out.getUTCDate() + 7);
  return out;
}

function weeklyBounds(now: Date): { weekStart: Date; weekEnd: Date } {
  const weekStart = startOfUtcWeek(now);
  return { weekStart, weekEnd: endOfUtcWeek(weekStart) };
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

type StudyPlanSnapshotRow = {
  id: string;
  weekStart: Date;
  weekEnd: Date;
  generatedAt: Date;
  summary: string;
  isStarter: boolean;
  weakAreas: unknown;
  items: unknown;
  sourceVersion: string;
};

type SavedWordForWeakness = { word: string };
type WeakWordMasteryRow = { lemma: string };

function countWeakSavedWords(
  savedWords: SavedWordForWeakness[],
  weakRows: WeakWordMasteryRow[],
): number {
  if (savedWords.length === 0 || weakRows.length === 0) return 0;
  const weakLemmas = new Set(weakRows.map((row) => row.lemma));
  let weakCount = 0;
  for (const savedWord of savedWords) {
    const lemma = lemmaFor(savedWord.word);
    if (lemma && weakLemmas.has(lemma)) {
      weakCount += 1;
    }
  }
  return weakCount;
}

function snapshotToStudyPlan(row: StudyPlanSnapshotRow): StudyPlanHistoryEntry {
  return {
    id: row.id,
    generatedAt: row.generatedAt.toISOString(),
    weekStart: row.weekStart.toISOString(),
    weekEnd: row.weekEnd.toISOString(),
    summary: row.summary,
    weakAreas: jsonArray<WeakArea>(row.weakAreas),
    items: jsonArray<StudyPlanItem>(row.items),
    isStarter: row.isStarter,
    sourceVersion: row.sourceVersion,
  };
}

async function computeStudyPlan(userId: string, now: Date): Promise<StudyPlan> {
  // Dynamic import avoids a static learning ↔ recommendations cycle while still
  // wiring the article-recommendation step as the default implementation.
  const { listScoredPicksPage } = await import("@/lib/recommendations/picks");
  const diag = await gatherStudyDiagnostics(userId, async () => {
    const picks = await listScoredPicksPage(userId, { limit: 1 });
    const topPick = picks.articles[0] ?? null;
    return readingRecFromTopPick(topPick, picks.reasons);
  });
  const weakAreas = diagnoseWeakAreas(diag);
  const items = buildWeeklyPlan(weakAreas, diag);
  const isStarter = weakAreas.length === 0;
  const { weekStart, weekEnd } = weeklyBounds(now);
  return {
    generatedAt: now.toISOString(),
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    summary: summarize(weakAreas, isStarter),
    weakAreas,
    items,
    isStarter,
  };
}

async function persistStudyPlanSnapshot(
  userId: string,
  plan: StudyPlan,
): Promise<StudyPlanHistoryEntry> {
  const now = new Date(plan.generatedAt);
  const { weekStart, weekEnd } = weeklyBounds(now);
  const row = await prisma.studyPlanSnapshot.upsert({
    where: { userId_weekStart: { userId, weekStart } },
    create: {
      userId,
      weekStart,
      weekEnd,
      generatedAt: now,
      summary: plan.summary,
      weakAreas: plan.weakAreas,
      items: plan.items,
      isStarter: plan.isStarter,
      sourceVersion: STUDY_PLAN_SOURCE_VERSION,
    },
    update: {
      weekEnd,
      generatedAt: now,
      summary: plan.summary,
      weakAreas: plan.weakAreas,
      items: plan.items,
      isStarter: plan.isStarter,
      sourceVersion: STUDY_PLAN_SOURCE_VERSION,
    },
  });
  return snapshotToStudyPlan(row);
}

export type GenerateStudyPlanOptions = {
  now?: Date;
  refresh?: boolean;
  persist?: boolean;
};

/**
 * Returns the learner's weekly study plan. By default this is stable for the
 * current UTC week: the first call computes and persists a snapshot, and later
 * calls return the saved row. Pass `{ refresh: true }` for administrative/test
 * recomputation of the current week.
 */
export async function generateStudyPlan(
  userId: string,
  opts: GenerateStudyPlanOptions = {},
): Promise<StudyPlan> {
  const now = opts.now ?? new Date();
  const { weekStart } = weeklyBounds(now);

  if (opts.persist !== false && !opts.refresh) {
    const existing = await prisma.studyPlanSnapshot.findUnique({
      where: { userId_weekStart: { userId, weekStart } },
    });
    if (existing) return snapshotToStudyPlan(existing);
  }

  const plan = await computeStudyPlan(userId, now);
  if (opts.persist === false) return plan;
  return persistStudyPlanSnapshot(userId, plan);
}

export async function getStudyPlanHistory(
  userId: string,
  opts: { limit?: number } = {},
): Promise<StudyPlanHistoryEntry[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT));
  const rows = await prisma.studyPlanSnapshot.findMany({
    where: { userId },
    orderBy: { weekStart: "desc" },
    take: limit,
  });
  return rows.map(snapshotToStudyPlan);
}
