/**
 * Tests for the RW-039 transparent recommendation scoring engine.
 *
 * The component scorers and ranking are PURE, so most assertions construct a
 * {@link RecommendationContext} directly — no DB needed. A couple of integration
 * tests drive {@link scoreAndRankArticles} / {@link listScoredPicksPage} through
 * a fully mocked prisma + cache to exercise the new-user graceful path.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type {
  RecommendationCandidate,
  RecommendationContext,
} from "@/lib/recommendations/types";
import {
  makeRecommendationCandidate as candidate,
  makeRecommendationContext as baseContext,
} from "./support/learning-fixtures";

// ---------------------------------------------------------------------------
// Mutable prisma state (driven by the mock below)
// ---------------------------------------------------------------------------

let profileRow: Record<string, unknown> | null = null;
let feedbackRows: Array<{ vote: string; _count: { _all: number } }> = [];
let quizRows: Array<{ scorePct: number }> = [];
let completedAtLevelCount = 0;
let skillRows: Array<{ skill: string; confidence: number; evidenceCount: number }> = [];
let wordAgg = { _avg: { familiarity: null as number | null }, _count: { _all: 0 } };
let progressRows: Array<{ articleId: string; percent: number; completed: boolean }> = [];
let masteryRows: Array<{ articleId: string; comprehensionScore: number; lastActivityAt: Date }> = [];
let articleRows: Array<Record<string, unknown>> = [];
let articleTagRows: Array<{ articleId: string; tag: { slug: string } }> = [];

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
        profile: {
          findUnique: async () => profileRow,
        },
        articleDifficultyFeedback: {
          groupBy: async () => feedbackRows,
        },
        quizAttempt: {
          findMany: async () => quizRows,
        },
        skillMastery: {
          findMany: async () => skillRows,
        },
        wordMastery: {
          aggregate: async () => wordAgg,
        },
        readingProgress: {
          count: async () => completedAtLevelCount,
          findMany: async () => progressRows,
        },
        articleMastery: {
          findMany: async () => masteryRows,
        },
        article: {
          findMany: async () => articleRows,
        },
        articleTag: {
          findMany: async () => articleTagRows,
        },
      },
    },
  });
});

beforeEach(() => {
  profileRow = null;
  feedbackRows = [];
  quizRows = [];
  completedAtLevelCount = 0;
  skillRows = [];
  wordAgg = { _avg: { familiarity: null }, _count: { _all: 0 } };
  progressRows = [];
  masteryRows = [];
  articleRows = [];
  articleTagRows = [];
});

// ---------------------------------------------------------------------------
// Fixtures (NOW matches learning-fixtures.ts to keep cross-file consistency)
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-23T00:00:00Z");

// ---------------------------------------------------------------------------
// Pure component scorers
// ---------------------------------------------------------------------------

test("levelFitScore: perfect match scores highest; too-hard penalised more than easy", async () => {
  const { levelFitScore } = await import("@/lib/discovery-ranking");
  // rank 2 = B1 user
  assert.equal(levelFitScore(2, 2), 1); // exact
  assert.ok(levelFitScore(1, 2) > levelFitScore(3, 2)); // one-easier > one-harder
  assert.ok(levelFitScore(0, 2) > levelFitScore(4, 2)); // two-easier > two-harder
  assert.equal(levelFitScore(null, 2), 0.5); // unknown article → neutral
  assert.equal(levelFitScore(2, null), 0.5); // unknown user → neutral
});

test("topicInterestScore: category match is full credit, tags partial, no topics neutral", async () => {
  const { topicInterestScore } = await import("@/lib/discovery-ranking");
  const topics = new Set(["science", "technology"]);
  assert.equal(topicInterestScore("science", [], topics), 1);
  assert.equal(topicInterestScore("sports", ["technology"], topics), 0.4);
  assert.equal(topicInterestScore("sports", ["unknown"], topics), 0);
  assert.equal(topicInterestScore("sports", [], new Set()), 0.5); // no topics → neutral
});

test("noveltyScore: completed=0, in-progress mid, never-seen=1, mastery decays by age", async () => {
  const { noveltyScore } = await import("@/lib/recommendations/scoring");
  const completed = new Set(["done"]);
  const inProgress = new Map([["mid", 40]]);
  const recent = new Date(NOW.getTime() - 1 * 86_400_000);
  const old = new Date(NOW.getTime() - 30 * 86_400_000);
  const mastery = new Map([
    ["recent", { comprehensionScore: 0.5, lastActivityAt: recent }],
    ["old", { comprehensionScore: 0.5, lastActivityAt: old }],
  ]);
  assert.equal(noveltyScore("done", completed, inProgress, mastery, NOW), 0);
  assert.equal(noveltyScore("mid", completed, inProgress, mastery, NOW), 0.45);
  assert.equal(noveltyScore("fresh", completed, inProgress, mastery, NOW), 1);
  assert.ok(
    noveltyScore("old", completed, inProgress, mastery, NOW) >
      noveltyScore("recent", completed, inProgress, mastery, NOW),
  );
});

test("difficultyFeedbackScore: negative bias rewards easier, positive rewards harder", async () => {
  const { difficultyFeedbackScore } = await import("@/lib/recommendations/scoring");
  // user keeps finding articles too hard → bias negative → easier article scores higher
  assert.ok(difficultyFeedbackScore(1, 2, -1) > difficultyFeedbackScore(3, 2, -1));
  // wants harder → bias positive → harder scores higher
  assert.ok(difficultyFeedbackScore(3, 2, 1) > difficultyFeedbackScore(1, 2, 1));
  assert.equal(difficultyFeedbackScore(2, 2, 0), 0.5); // no bias / exact → neutral
});

test("freshnessScore01: decays with publication age", async () => {
  const { freshnessScore01 } = await import("@/lib/discovery-ranking");
  const recent = new Date(NOW.getTime() - 2 * 86_400_000);
  const old = new Date(NOW.getTime() - 365 * 86_400_000);
  assert.equal(freshnessScore01(recent, NOW), 1);
  assert.ok(freshnessScore01(old, NOW) < freshnessScore01(recent, NOW));
  assert.equal(freshnessScore01(null, NOW), 0.1);
  // cached dates arrive as ISO strings — must still work.
  assert.equal(freshnessScore01(recent.toISOString(), NOW), 1);
});

test("masteryGapScore: unmastered articles score higher; weakest-skill boost applies", async () => {
  const { masteryGapScore } = await import("@/lib/recommendations/scoring");
  const mastery = new Map([
    ["mastered", { comprehensionScore: 0.95, lastActivityAt: NOW }],
    ["weak", { comprehensionScore: 0.1, lastActivityAt: NOW }],
  ]);
  assert.ok(
    masteryGapScore("weak", 2, 2, mastery, null) >
      masteryGapScore("mastered", 2, 2, mastery, null),
  );
  // reading-weak learner gets a boost for at/below-level content
  const withBoost = masteryGapScore("fresh", 1, 2, new Map(), "reading");
  const without = masteryGapScore("fresh", 1, 2, new Map(), null);
  assert.ok(withBoost > without);
  // Exact: fully mastered article (comprehensionScore=1.0) leaves no gap → 0.
  const fullyMastered = new Map([["done", { comprehensionScore: 1.0, lastActivityAt: NOW }]]);
  assert.equal(masteryGapScore("done", null, null, fullyMastered, null), 0);
});

test("wordLoadScore: null article/user rank yields a near-1 neutral score", async () => {
  const { wordLoadScore } = await import("@/lib/recommendations/scoring");
  // null rank → delta=0, zero vocab strength → expectedLoad≈0.35 → score≈0.9286.
  const score = wordLoadScore(null, null, { avgFamiliarity: 0, knownCount: 0 });
  assert.equal(Math.round(score * 1e4) / 1e4, 0.9286);
});

// ---------------------------------------------------------------------------
// scoreCandidate — explanations + components
// ---------------------------------------------------------------------------

test("scoreCandidate returns component sub-scores, a reason, and per-component explanation", async () => {
  const { scoreCandidate } = await import("@/lib/recommendations/scoring");
  const { COMPONENT_WEIGHTS } = await import("@/lib/recommendations/types");
  const ctx = baseContext({ userLevel: "B1", userLevelRank: 2, topicSet: new Set(["science"]) });
  const result = scoreCandidate(
    candidate({ id: "a1", category: "science", difficulty: "B1" }),
    ctx,
  );
  // all seven components present
  const keys = Object.keys(result.components).sort();
  assert.deepEqual(keys, Object.keys(COMPONENT_WEIGHTS).sort());
  assert.ok(typeof result.reason === "string" && result.reason.length > 0);
  assert.equal(result.explanation.length, 7);
  assert.ok(result.explanation.every((line) => /%/.test(line)));
  assert.ok(result.score >= 0 && result.score <= 100);
});

test("ranking changes for different learner profiles", async () => {
  const { scoreCandidate } = await import("@/lib/recommendations/scoring");
  const sci = candidate({ id: "sci", category: "science", difficulty: "B1" });
  const sport = candidate({ id: "sport", category: "sports", difficulty: "A2" });

  // Profile 1: B1 science learner → science ranks above sports
  const p1 = baseContext({ userLevel: "B1", userLevelRank: 2, topicSet: new Set(["science"]) });
  assert.ok(scoreCandidate(sci, p1).score > scoreCandidate(sport, p1).score);

  // Profile 2: A2 sports learner → sports ranks above science
  const p2 = baseContext({ userLevel: "A2", userLevelRank: 1, topicSet: new Set(["sports"]) });
  assert.ok(scoreCandidate(sport, p2).score > scoreCandidate(sci, p2).score);
});

test("novelty effect: an unread article outranks an otherwise-identical completed one", async () => {
  const { scoreCandidate } = await import("@/lib/recommendations/scoring");
  const ctx = baseContext({
    userLevel: "B1",
    userLevelRank: 2,
    completedIds: new Set(["seen"]),
  });
  const seen = scoreCandidate(candidate({ id: "seen", category: "science", difficulty: "B1" }), ctx);
  const fresh = scoreCandidate(candidate({ id: "fresh", category: "science", difficulty: "B1" }), ctx);
  assert.ok(fresh.score > seen.score);
});

// ---------------------------------------------------------------------------
// Diversity
// ---------------------------------------------------------------------------

test("rankWithDiversity spreads categories instead of clustering the top one", async () => {
  const { scoreCandidate } = await import("@/lib/recommendations/scoring");
  const { rankWithDiversity } = await import("@/lib/recommendations/diversity");
  const ctx = baseContext({ userLevel: "B1", userLevelRank: 2 });
  // 4 science + 1 sports, science slightly higher base.
  const scored = [
    scoreCandidate(candidate({ id: "s1", category: "science", difficulty: "B1" }), ctx),
    scoreCandidate(candidate({ id: "s2", category: "science", difficulty: "B1" }), ctx),
    scoreCandidate(candidate({ id: "s3", category: "science", difficulty: "B1" }), ctx),
    scoreCandidate(candidate({ id: "s4", category: "science", difficulty: "B1" }), ctx),
    scoreCandidate(candidate({ id: "sp1", category: "sports", difficulty: "B1" }), ctx),
  ];
  const ranked = rankWithDiversity(scored);
  // The sports article should NOT be dead last despite a lower/equal base —
  // diversity lifts it above the 3rd+ science repeat.
  const sportsIdx = ranked.findIndex((r) => r.category === "sports");
  assert.ok(sportsIdx >= 0 && sportsIdx < 4, `sports at ${sportsIdx}`);
  // A later same-category pick carries a recorded diversity penalty + note.
  const penalised = ranked.find((r) => r.diversityPenalty > 0);
  assert.ok(penalised, "expected at least one diversity-penalised result");
  assert.ok(penalised!.explanation.some((l) => /diversity/.test(l)));
});

// ---------------------------------------------------------------------------
// Integration — new-user graceful degradation
// ---------------------------------------------------------------------------

test("scoreAndRankArticles is graceful for a brand-new user (no profile / no mastery)", async () => {
  const { scoreAndRankArticles } = await import("@/lib/recommendations/picks");
  const ranked = await scoreAndRankArticles("new-user", [
    candidate({ id: "a1", category: "science", difficulty: "B1" }),
    candidate({ id: "a2", category: "sports", difficulty: "A2" }),
  ]);
  assert.equal(ranked.length, 2);
  for (const r of ranked) {
    assert.ok(r.score >= 0 && r.score <= 100);
    assert.ok(r.reason.length > 0);
    // neutral level fit (0.5) since the user has no level yet
    assert.equal(r.components.levelFit, 0.5);
    // every article is novel for a new user
    assert.equal(r.components.novelty, 1);
  }
});

test("scoreAndRankArticles reflects the adaptive level: repeated too_hard favours easier", async () => {
  const { scoreAndRankArticles } = await import("@/lib/recommendations/picks");
  // B1 profile, but repeated "too hard" feedback → adaptive engine targets A2.
  profileRow = { userId: "u1", englishLevel: "B1", topics: "[]" };
  feedbackRows = [{ vote: "too_hard", _count: { _all: 5 } }];
  const ranked = await scoreAndRankArticles("u1", [
    candidate({ id: "easy", category: "science", difficulty: "A2" }),
    candidate({ id: "hard", category: "science", difficulty: "B2" }),
  ]);
  const easy = ranked.find((r) => r.id === "easy")!;
  const hard = ranked.find((r) => r.id === "hard")!;
  assert.ok(easy.score > hard.score, "easier article should outrank harder after too_hard feedback");
});

test("listScoredPicksPage paginates scored candidates and carries reasons + explanations", async () => {
  const { listScoredPicksPage } = await import("@/lib/recommendations/picks");
  articleRows = [
    { id: "a1", title: "A1", author: "x", source: "s", category: "science", difficulty: "B1", readingMinutes: 5, wordCount: 600, publishedAt: NOW, heroImage: null },
    { id: "a2", title: "A2", author: "x", source: "s", category: "sports", difficulty: "B1", readingMinutes: 5, wordCount: 600, publishedAt: NOW, heroImage: null },
    { id: "a3", title: "A3", author: "x", source: "s", category: "health", difficulty: "B1", readingMinutes: 5, wordCount: 600, publishedAt: NOW, heroImage: null },
  ];
  const page = await listScoredPicksPage("u1", { limit: 2 });
  assert.equal(page.articles.length, 2);
  assert.equal(page.hasMore, true);
  // reasons + full scored detail keyed by article id
  for (const a of page.articles) {
    assert.ok(page.reasons[a.id]?.length > 0);
    assert.ok(page.scored[a.id]);
    assert.equal(page.scored[a.id].explanation.length >= 7, true);
  }
});

test("listScoredPicksPage returns an empty page when there are no candidates", async () => {
  const { listScoredPicksPage } = await import("@/lib/recommendations/picks");
  articleRows = [];
  const page = await listScoredPicksPage("u1", { limit: 6 });
  assert.deepEqual(page.articles, []);
  assert.equal(page.hasMore, false);
});
