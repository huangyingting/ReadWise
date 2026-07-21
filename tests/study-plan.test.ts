/**
 * Tests for the RW-041 weakness diagnostics & study-plan generation in
 * `@/lib/learning/study-plan`. The diagnosis ({@link diagnoseWeakAreas}) and plan
 * synthesis ({@link buildWeeklyPlan}) are pure functions over a
 * {@link StudyDiagnostics} snapshot, so they're tested directly. A couple of
 * integration tests drive {@link generateStudyPlan} through a mocked prisma.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { StudyDiagnostics } from "@/lib/learning/study-plan";
import type { SkillSummary, Skill } from "@/lib/learning/types";
import { makeStudyDiagnostics, makeSkillSummaries } from "./support/learning-fixtures";

/** Local alias to keep existing call-sites readable. */
const diag = makeStudyDiagnostics;

/** Build a full set of SkillSummary rows with optional per-skill overrides. */
function skills(overrides: Partial<Record<Skill, Partial<SkillSummary>>> = {}): SkillSummary[] {
  return makeSkillSummaries(overrides);
}

async function loadStudyPlan() {
  return import("@/lib/learning/study-plan");
}

// ---------------------------------------------------------------------------
// Mutable prisma state (for the integration tests)
// ---------------------------------------------------------------------------

let skillRows: Array<{ skill: string; confidence: number; evidenceCount: number }> = [];
let coachRows: Array<{
  skill: string;
  confidence: number;
  evidenceCount: number;
  lastObservedAt: Date;
  trend: string;
  createdAt: Date;
}> = [];
let profileRow: Record<string, unknown> | null = null;
let feedbackRows: Array<{ vote: string; _count: { _all: number } }> = [];
let quizFindMany: Array<{ scorePct: number }> = [];
let savedWordRows: Array<{ word: string }> = [];
let weakWordMasteryRows: Array<{ lemma: string; sourceArticleIds?: unknown }> = [];
let dueCount = 0;
let lowCompCount = 0;
let assessedCount = 0;
let quizAgg = { _avg: { scorePct: null as number | null }, _count: { _all: 0 } };
let pronAgg = { _avg: { pronScore: null as number | null }, _count: { _all: 0 } };
let articleRows: Array<Record<string, unknown>> = [];
let studyPlanSnapshots: Array<{
  id: string;
  userId: string;
  weekStart: Date;
  weekEnd: Date;
  generatedAt: Date;
  summary: string;
  isStarter: boolean;
  weakAreas: unknown[];
  items: unknown[];
  sourceVersion: string;
}> = [];

const LEARNER_ID = "u1";

function resetStudyPlanState(): void {
  skillRows = [];
  coachRows = [];
  profileRow = null;
  feedbackRows = [];
  quizFindMany = [];
  savedWordRows = [];
  weakWordMasteryRows = [];
  dueCount = 0;
  lowCompCount = 0;
  assessedCount = 0;
  quizAgg = { _avg: { scorePct: null }, _count: { _all: 0 } };
  pronAgg = { _avg: { pronScore: null }, _count: { _all: 0 } };
  articleRows = [];
  studyPlanSnapshots = [];
}

function useB1Profile(userId = LEARNER_ID): void {
  profileRow = { userId, englishLevel: "B1", topics: "[]" };
}

function setSavedWeakness(words: string[], weakLemmas: string[]): void {
  savedWordRows = words.map((word) => ({ word }));
  weakWordMasteryRows = weakLemmas.map((lemma) => ({ lemma }));
}

function hasWeakArea(plan: { weakAreas: Array<{ kind: string }> }, kind: string): boolean {
  return plan.weakAreas.some((area) => area.kind === kind);
}

before(() => {
  mock.module("@/lib/cache", {
    namedExports: {
      ARTICLES_CACHE_TAG: "articles",
      TAGS_CACHE_TAG: "tags",
      createCachedListing: (fn: (...args: never[]) => unknown) => fn,
    },
  });
  mock.module("@/lib/ai", {
    namedExports: {
      isAiConfigured: () => false,
      aiModelName: () => null,
      chatComplete: async () => null,
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        profile: { findUnique: async () => profileRow },
        articleDifficultyFeedback: { groupBy: async () => feedbackRows },
        readingProgress: { count: async () => 0, findMany: async () => [] },
        skillMastery: { findMany: async () => skillRows },
        learnerCoachMemory: { findMany: async () => coachRows },
        quizAttempt: {
          findMany: async () => quizFindMany,
          aggregate: async () => quizAgg,
        },
        wordMastery: {
          aggregate: async () => ({ _avg: { familiarity: null }, _count: { _all: 0 } }),
          findMany: async (args?: { select?: Record<string, unknown> }) => {
            if (args?.select && "lemma" in args.select) return weakWordMasteryRows;
            return weakWordMasteryRows.map((row) => ({
              sourceArticleIds: row.sourceArticleIds ?? [],
            }));
          },
        },
        savedWord: {
          count: async (a: { where?: { OR?: unknown } }) =>
            a.where && "OR" in a.where ? dueCount : savedWordRows.length,
          findMany: async () => savedWordRows,
        },
        articleMastery: {
          count: async (a: { where?: { comprehensionScore?: unknown } }) =>
            a.where && "comprehensionScore" in a.where ? lowCompCount : assessedCount,
          findMany: async () => [],
        },
        pronunciationAttempt: { aggregate: async () => pronAgg },
        studyPlanSnapshot: {
          findUnique: async (args: { where: { userId_weekStart: { userId: string; weekStart: Date } } }) =>
            studyPlanSnapshots.find(
              (row) =>
                row.userId === args.where.userId_weekStart.userId &&
                row.weekStart.getTime() === args.where.userId_weekStart.weekStart.getTime(),
            ) ?? null,
          upsert: async (args: {
            where: { userId_weekStart: { userId: string; weekStart: Date } };
            create: Omit<(typeof studyPlanSnapshots)[number], "id">;
            update: Partial<Omit<(typeof studyPlanSnapshots)[number], "id" | "userId" | "weekStart">>;
          }) => {
            const existing = studyPlanSnapshots.find(
              (row) =>
                row.userId === args.where.userId_weekStart.userId &&
                row.weekStart.getTime() === args.where.userId_weekStart.weekStart.getTime(),
            );
            if (existing) {
              Object.assign(existing, args.update);
              return existing;
            }
            const row = { id: `snapshot-${studyPlanSnapshots.length + 1}`, ...args.create };
            studyPlanSnapshots.push(row);
            return row;
          },
          findMany: async (args: { where: { userId: string }; take: number }) =>
            studyPlanSnapshots
              .filter((row) => row.userId === args.where.userId)
              .sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime())
              .slice(0, args.take),
        },
        article: { findMany: async () => articleRows },
        articleTag: { findMany: async () => [] },
      },
    },
  });
});

beforeEach(() => {
  resetStudyPlanState();
});

// ---------------------------------------------------------------------------
// diagnoseWeakAreas (pure)
// ---------------------------------------------------------------------------

test("diagnoseWeakAreas surfaces weak vocabulary grounded in saved-word numbers", async () => {
  const { diagnoseWeakAreas } = await loadStudyPlan();
  const areas = diagnoseWeakAreas(
    diag({ vocab: { weakCount: 8, dueCount: 5, totalSaved: 10 } }),
  );
  const vocab = areas.find((a) => a.kind === "vocabulary");
  assert.ok(vocab, "expected a vocabulary weak area");
  assert.ok(vocab!.severity > 0);
  assert.ok(vocab!.evidence.some((e) => /8 saved word/.test(e)));
  assert.ok(vocab!.evidence.some((e) => /5 flashcard/.test(e)));
});

test("diagnoseWeakAreas surfaces comprehension from low quiz average", async () => {
  const { diagnoseWeakAreas } = await loadStudyPlan();
  const areas = diagnoseWeakAreas(
    diag({ quiz: { averageScore: 45, totalAttempts: 6 }, comprehension: { lowCount: 3, assessedCount: 5 } }),
  );
  const comp = areas.find((a) => a.kind === "comprehension");
  assert.ok(comp);
  assert.ok(comp!.detail.includes("45%"));
});

test("diagnoseWeakAreas surfaces pronunciation + listening/grammar from skill confidence", async () => {
  const { diagnoseWeakAreas } = await loadStudyPlan();
  const areas = diagnoseWeakAreas(
    diag({
      pronunciation: { avgScore: 40, attempts: 4 },
      skills: skills({
        listening: { confidence: 0.2, evidenceCount: 3, hasEvidence: true },
        grammar: { confidence: 0.3, evidenceCount: 3, hasEvidence: true },
      }),
    }),
  );
  assert.ok(areas.some((a) => a.kind === "pronunciation"));
  assert.ok(areas.some((a) => a.kind === "listening"));
  assert.ok(areas.some((a) => a.kind === "grammar"));
});

test("diagnoseWeakAreas is empty for a learner with no recorded weaknesses", async () => {
  const { diagnoseWeakAreas } = await loadStudyPlan();
  assert.deepEqual(diagnoseWeakAreas(diag()), []);
});

test("diagnoseWeakAreas sorts by severity (weakest first)", async () => {
  const { diagnoseWeakAreas } = await loadStudyPlan();
  const areas = diagnoseWeakAreas(
    diag({
      vocab: { weakCount: 1, dueCount: 1, totalSaved: 10 }, // low severity
      pronunciation: { avgScore: 10, attempts: 5 }, // high severity
    }),
  );
  assert.ok(areas.length >= 2);
  for (let i = 1; i < areas.length; i++) {
    assert.ok(areas[i - 1].severity >= areas[i].severity);
  }
});

// ---------------------------------------------------------------------------
// buildWeeklyPlan (pure)
// ---------------------------------------------------------------------------

test("buildWeeklyPlan links weak vocabulary to flashcard review when words are due", async () => {
  const { diagnoseWeakAreas, buildWeeklyPlan } = await loadStudyPlan();
  const d = diag({ vocab: { weakCount: 4, dueCount: 3, totalSaved: 8 } });
  const items = buildWeeklyPlan(diagnoseWeakAreas(d), d);
  const review = items.find((i) => i.kind === "vocabulary");
  assert.ok(review);
  assert.equal(review!.href, "/study");
  assert.ok(/review/i.test(review!.cta));
});

test("buildWeeklyPlan returns a sensible STARTER plan for a brand-new learner", async () => {
  const { buildWeeklyPlan } = await loadStudyPlan();
  const items = buildWeeklyPlan([], diag());
  assert.ok(items.length > 0);
  assert.ok(items.some((i) => i.href === "/browse?view=picks"));
  // starter plan steers to reading + a quiz to start building history
  assert.ok(items.some((i) => i.id.startsWith("starter:")));
});

test("buildWeeklyPlan appends the top reading recommendation when available", async () => {
  const { diagnoseWeakAreas, buildWeeklyPlan } = await loadStudyPlan();
  const d = diag({
    vocab: { weakCount: 4, dueCount: 0, totalSaved: 8 },
    readingRec: { id: "art-9", title: "Coral Reefs", reason: "Right for your B1 level" },
  });
  const items = buildWeeklyPlan(diagnoseWeakAreas(d), d);
  const rec = items.find((i) => i.kind === "reading-rec");
  assert.ok(rec);
  assert.equal(rec!.href, "/reader/art-9");
  assert.ok(rec!.title.includes("Coral Reefs"));
});

test("buildWeeklyPlan stays focused (caps the number of items)", async () => {
  const { diagnoseWeakAreas, buildWeeklyPlan } = await loadStudyPlan();
  const d = diag({
    vocab: { weakCount: 9, dueCount: 9, totalSaved: 10 },
    quiz: { averageScore: 30, totalAttempts: 9 },
    comprehension: { lowCount: 9, assessedCount: 10 },
    pronunciation: { avgScore: 20, attempts: 9 },
    skills: skills({
      listening: { confidence: 0.1, evidenceCount: 5, hasEvidence: true },
      grammar: { confidence: 0.1, evidenceCount: 5, hasEvidence: true },
    }),
    readingRec: { id: "art-1", title: "T", reason: "r" },
  });
  const items = buildWeeklyPlan(diagnoseWeakAreas(d), d);
  assert.ok(items.length <= 6);
});

// ---------------------------------------------------------------------------
// generateStudyPlan (DB) — grounded + updates with new data
// ---------------------------------------------------------------------------

test("generateStudyPlan returns a starter plan for a brand-new user", async () => {
  const { generateStudyPlan } = await loadStudyPlan();
  const plan = await generateStudyPlan("new-user");
  assert.equal(plan.isStarter, true);
  assert.deepEqual(plan.weakAreas, []);
  assert.ok(plan.items.length > 0);
  assert.ok(/start/i.test(plan.summary));
});

test("generateStudyPlan reflects synthetic weak areas and updates with new data", async () => {
  const { generateStudyPlan } = await loadStudyPlan();
  useB1Profile();

  // Round 1: lots of weak words + low quiz average → vocabulary + comprehension.
  setSavedWeakness(
    ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"],
    ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"],
  );
  dueCount = 4;
  quizAgg = { _avg: { scorePct: 42 }, _count: { _all: 6 } };
  lowCompCount = 2;
  assessedCount = 4;
  const before = await generateStudyPlan(LEARNER_ID, { persist: false });
  assert.equal(before.isStarter, false);
  assert.ok(hasWeakArea(before, "vocabulary"));
  assert.ok(hasWeakArea(before, "comprehension"));
  assert.ok(before.items.some((i) => i.kind === "vocabulary"));

  // Round 2: learner improved — words mastered, quiz up → fewer weak areas.
  setSavedWeakness(
    ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"],
    [],
  );
  dueCount = 0;
  quizAgg = { _avg: { scorePct: 88 }, _count: { _all: 8 } };
  lowCompCount = 0;
  const after = await generateStudyPlan(LEARNER_ID, { persist: false });
  assert.ok(after.weakAreas.length < before.weakAreas.length);
});

test("generateStudyPlan counts weak vocabulary over saved words, not all tracked mastery rows", async () => {
  const { gatherStudyDiagnostics } = await loadStudyPlan();
  useB1Profile();
  savedWordRows = [{ word: "saved-known" }, { word: "saved-weak" }];
  weakWordMasteryRows = [
    { lemma: "saved-weak" },
    { lemma: "unsaved-weak" },
  ];

  const diagnostics = await gatherStudyDiagnostics(LEARNER_ID);

  assert.deepEqual(diagnostics.vocab, {
    weakCount: 1,
    dueCount: 0,
    totalSaved: 2,
  });
});

test("generateStudyPlan persists one stable weekly snapshot and exposes history", async () => {
  const { generateStudyPlan, getStudyPlanHistory } = await loadStudyPlan();
  useB1Profile();
  setSavedWeakness(
    ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"],
    ["alpha", "beta", "gamma", "delta", "epsilon"],
  );
  dueCount = 3;

  const first = await generateStudyPlan(LEARNER_ID, {
    now: new Date("2026-07-01T12:00:00Z"),
  });
  assert.equal(studyPlanSnapshots.length, 1);
  assert.ok(first.weekStart);
  assert.ok(hasWeakArea(first, "vocabulary"));

  setSavedWeakness(
    ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"],
    [],
  );
  dueCount = 0;
  const stable = await generateStudyPlan(LEARNER_ID, {
    now: new Date("2026-07-02T12:00:00Z"),
  });
  assert.deepEqual(stable.weakAreas, first.weakAreas);
  assert.equal(studyPlanSnapshots.length, 1);

  const refreshed = await generateStudyPlan(LEARNER_ID, {
    now: new Date("2026-07-02T12:00:00Z"),
    refresh: true,
  });
  assert.ok(refreshed.weakAreas.length < first.weakAreas.length);
  assert.equal(studyPlanSnapshots.length, 1);

  const history = await getStudyPlanHistory(LEARNER_ID);
  assert.equal(history.length, 1);
  assert.equal(history[0].id, "snapshot-1");
  assert.equal(history[0].sourceVersion, "study-plan-v1");
});

test("generateStudyPlan surfaces a reading recommendation from the picks engine", async () => {
  const { generateStudyPlan } = await loadStudyPlan();
  useB1Profile();
  setSavedWeakness(
    ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"],
    ["alpha", "beta", "gamma", "delta", "epsilon"],
  );
  dueCount = 0;
  articleRows = [
    { id: "art-7", title: "Rivers", author: "x", source: "s", category: "science", difficulty: "B1", readingMinutes: 5, wordCount: 600, publishedAt: new Date("2026-06-20T00:00:00Z"), heroImage: null },
  ];
  const plan = await generateStudyPlan(LEARNER_ID);
  assert.ok(plan.items.some((i) => i.kind === "reading-rec" && i.href === "/reader/art-7"));
});

// ---------------------------------------------------------------------------
// #810 — coach memory as a study-plan ranking signal (with SkillMastery fallback)
// ---------------------------------------------------------------------------

test("generateStudyPlan uses LearnerCoachMemory to surface a weak skill", async () => {
  const { generateStudyPlan } = await loadStudyPlan();
  useB1Profile();
  // No SkillMastery evidence at all — only coach memory knows grammar is weak.
  skillRows = [];
  coachRows = [
    {
      skill: "grammar",
      confidence: 0.1,
      evidenceCount: 5,
      lastObservedAt: new Date(),
      trend: "declining",
      createdAt: new Date(),
    },
  ];
  const plan = await generateStudyPlan(LEARNER_ID);
  assert.ok(
    hasWeakArea(plan, "grammar"),
    "grammar weakness should come from coach memory even without SkillMastery",
  );
});

test("generateStudyPlan falls back to SkillMastery when coach memory is empty", async () => {
  const { generateStudyPlan } = await loadStudyPlan();
  useB1Profile();
  coachRows = [];
  skillRows = [{ skill: "grammar", confidence: 0.2, evidenceCount: 4 }];
  const plan = await generateStudyPlan(LEARNER_ID);
  assert.ok(
    hasWeakArea(plan, "grammar"),
    "grammar weakness should come from SkillMastery when coach memory is empty",
  );
});
