/**
 * Unit tests for buildRecommendationContext in src/lib/recommendations/context.ts.
 *
 * All I/O (Prisma, profile, leveling, skill-mastery) is fully mocked. Tests cover:
 * - new-user graceful fallback (no profile, no adaptive, no mastery)
 * - adaptive-level override (adaptive.recommendedLevel takes precedence)
 * - empty candidateIds short-circuit (no progress/mastery queries fired)
 * - partial data (mixed profile + mastery rows assembled correctly)
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Mutable state consumed by the mocks
// ---------------------------------------------------------------------------

let profileRow: Record<string, unknown> | null = null;
let adaptiveResult: {
  recommendedLevel: string;
  difficultyBias: number;
  suggestion: string;
  currentLevel: string;
  targetLevel: string | null;
  confidence: number;
  explanation: string[];
  evidence: Record<string, unknown>;
} | null = null;
let skillProfileResult = {
  skills: [] as unknown[],
  overallConfidence: 0,
  totalEvidence: 0,
  weakest: null as string | null,
  strongest: null as string | null,
};
let wordMasteryAgg = {
  _avg: { familiarity: null as number | null },
  _count: { _all: 0 },
};
let progressRows: Array<{ articleId: string; percent: number; completed: boolean }> = [];
let masteryRows: Array<{ articleId: string; comprehensionScore: number; lastActivityAt: Date }> = [];
let weakWordMasteryRows: Array<{ sourceArticleIds: unknown }> = [];

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        wordMastery: {
          aggregate: async () => wordMasteryAgg,
          findMany: async () => weakWordMasteryRows,
        },
        readingProgress: {
          findMany: async () => progressRows,
        },
        articleMastery: {
          findMany: async () => masteryRows,
        },
      },
    },
  });

  mock.module("@/lib/profile", {
    namedExports: {
      getProfile: async () => profileRow,
      parseTopics: (topics: unknown) =>
        Array.isArray(topics) ? (topics as string[]) : [],
    },
  });

  mock.module("@/lib/leveling", {
    namedExports: {
      getAdaptiveLevelRecommendation: async () => adaptiveResult,
    },
  });

  mock.module("@/lib/learning/skill-mastery", {
    namedExports: {
      getSkillProfile: async () => skillProfileResult,
    },
  });
});

beforeEach(() => {
  profileRow = null;
  adaptiveResult = null;
  skillProfileResult = {
    skills: [],
    overallConfidence: 0,
    totalEvidence: 0,
    weakest: null,
    strongest: null,
  };
  wordMasteryAgg = { _avg: { familiarity: null }, _count: { _all: 0 } };
  progressRows = [];
  masteryRows = [];
  weakWordMasteryRows = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("buildRecommendationContext: new-user fallback — null level, empty sets, zero vocab", async () => {
  const { buildRecommendationContext } = await import("@/lib/recommendations/context");

  // No profile, no adaptive, no mastery
  const ctx = await buildRecommendationContext("new-user", ["a1", "a2"]);

  assert.strictEqual(ctx.userLevel, null);
  assert.strictEqual(ctx.userLevelRank, null);
  assert.strictEqual(ctx.topicSet.size, 0);
  assert.strictEqual(ctx.completedIds.size, 0);
  assert.strictEqual(ctx.inProgressPercent.size, 0);
  assert.strictEqual(ctx.masteryByArticle.size, 0);
  assert.strictEqual(ctx.difficultyBias, 0);
  assert.strictEqual(ctx.weakestSkill, null);
  assert.strictEqual(ctx.vocab.avgFamiliarity, 0);
  assert.strictEqual(ctx.vocab.knownCount, 0);
});

test("buildRecommendationContext: adaptive-level override takes precedence over profile level", async () => {
  const { buildRecommendationContext } = await import("@/lib/recommendations/context");

  profileRow = { userId: "u1", englishLevel: "B1", topics: "[]" };
  adaptiveResult = {
    suggestion: "down",
    currentLevel: "B1",
    recommendedLevel: "A2",
    targetLevel: "A2",
    confidence: 0.8,
    difficultyBias: -0.5,
    explanation: [],
    evidence: {},
  };

  const ctx = await buildRecommendationContext("u1", []);

  // adaptive overrides profile level
  assert.strictEqual(ctx.userLevel, "A2");
  assert.strictEqual(ctx.difficultyBias, -0.5);
  // level rank for A2 should be > -1
  assert.ok(ctx.userLevelRank !== null, "rank should not be null for a known level");
});

test("buildRecommendationContext: empty candidateIds → no progress/mastery rows fetched", async () => {
  const { buildRecommendationContext } = await import("@/lib/recommendations/context");

  // Simulate DB returning data — but since candidateIds=[], it should short-circuit
  progressRows = [{ articleId: "should-never-appear", percent: 50, completed: false }];
  masteryRows = [
    {
      articleId: "should-never-appear",
      comprehensionScore: 0.8,
      lastActivityAt: new Date(),
    },
  ];

  const ctx = await buildRecommendationContext("u-empty-candidates", []);

  assert.strictEqual(ctx.completedIds.size, 0, "completedIds should be empty when candidateIds is []");
  assert.strictEqual(ctx.inProgressPercent.size, 0);
  assert.strictEqual(ctx.masteryByArticle.size, 0);
});

test("buildRecommendationContext: partial data — progress + mastery assembled correctly", async () => {
  const { buildRecommendationContext } = await import("@/lib/recommendations/context");

  profileRow = { userId: "u2", englishLevel: "B2", topics: ["science", "history"] };
  wordMasteryAgg = { _avg: { familiarity: 0.6 }, _count: { _all: 30 } };
  progressRows = [
    { articleId: "art-1", percent: 100, completed: true },
    { articleId: "art-2", percent: 60, completed: false },
  ];
  const mastered = new Date("2025-01-15");
  masteryRows = [{ articleId: "art-1", comprehensionScore: 0.9, lastActivityAt: mastered }];

  const ctx = await buildRecommendationContext("u2", ["art-1", "art-2"]);

  // topics come from profile (no adaptive override)
  assert.ok(ctx.topicSet.has("science"), "topics should include 'science'");
  assert.ok(ctx.topicSet.has("history"), "topics should include 'history'");

  // completed article is tracked
  assert.ok(ctx.completedIds.has("art-1"), "art-1 should be in completedIds");

  // in-progress article is tracked
  assert.strictEqual(ctx.inProgressPercent.get("art-2"), 60);

  // mastery data assembled
  const m = ctx.masteryByArticle.get("art-1");
  assert.ok(m, "art-1 mastery should be present");
  assert.strictEqual(m!.comprehensionScore, 0.9);

  // vocab stats
  assert.strictEqual(ctx.vocab.avgFamiliarity, 0.6);
  assert.strictEqual(ctx.vocab.knownCount, 30);
});

test("buildRecommendationContext: profile level used when adaptive is null", async () => {
  const { buildRecommendationContext } = await import("@/lib/recommendations/context");

  profileRow = { userId: "u3", englishLevel: "C1", topics: "[]" };
  // adaptiveResult remains null (set in beforeEach)

  const ctx = await buildRecommendationContext("u3", []);

  assert.strictEqual(ctx.userLevel, "C1");
  assert.ok(ctx.userLevelRank !== null, "rank should not be null for C1");
});

test("buildRecommendationContext: placementLevel override (#806) takes precedence over adaptive", async () => {
  const { buildRecommendationContext } = await import("@/lib/recommendations/context");
  const { levelRank } = await import("@/lib/leveling/cefr-primitives");

  // Strong adaptive evidence says C1, but a fresh placement seeds B1.
  adaptiveResult = {
    recommendedLevel: "C1",
    difficultyBias: 0,
    suggestion: "hold",
    currentLevel: "C1",
    targetLevel: null,
    confidence: 1,
    explanation: [],
    evidence: {},
  };
  profileRow = { userId: "u4", englishLevel: "C1", topics: "[]" };

  const ctx = await buildRecommendationContext("u4", [], new Date(), {
    placementLevel: "B1",
  });

  assert.strictEqual(ctx.userLevel, "B1");
  assert.strictEqual(ctx.userLevelRank, levelRank("B1"));
});

test("buildRecommendationContext: invalid placementLevel falls back to adaptive/profile", async () => {
  const { buildRecommendationContext } = await import("@/lib/recommendations/context");

  adaptiveResult = null;
  profileRow = { userId: "u5", englishLevel: "B2", topics: "[]" };

  const ctx = await buildRecommendationContext("u5", [], new Date(), {
    placementLevel: "not-a-level" as never,
  });

  assert.strictEqual(ctx.userLevel, "B2");
});
