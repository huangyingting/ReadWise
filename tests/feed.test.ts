/**
 * Tests for the personalized feed ranking logic (M15).
 *
 * ALL imports of @/lib/feed happen via `await import()` inside each test
 * (US-032 pattern): mocks must be registered before the module is first loaded
 * so that feed.ts binds to mocked dependencies, not real prisma/profile.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { ScoringContext, ScoredArticle } from "@/lib/feed";
import { buildArticle } from "./helpers";

// ---------------------------------------------------------------------------
// Mutable state for DB-backed tests
// ---------------------------------------------------------------------------

let mockArticles: ReturnType<typeof buildArticle>[] = [];
let mockProgress: { articleId: string; completed: boolean; percent: number }[] = [];
let mockTagRows: { articleId: string; tag: { slug: string } }[] = [];
let mockProfile: {
  completedAt: Date | null;
  englishLevel: string;
  topics: string;
} | null = null;
let lastArticleFindManyArgs: { where?: Record<string, unknown>; select?: Record<string, unknown> } | null = null;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        article: {
          findMany: async (args: { where?: Record<string, unknown>; select?: Record<string, unknown> }) => {
            lastArticleFindManyArgs = args ?? null;
            return mockArticles;
          },
          update: async () => ({}),
        },
        readingProgress: {
          findMany: async (args: { where?: { completed?: boolean } }) => {
            // Split completed vs in-progress to mirror the real queries the feed
            // now issues (one for DB-level completed exclusion, one for penalty).
            if (args?.where?.completed === true) {
              return mockProgress.filter((p) => p.completed);
            }
            if (args?.where?.completed === false) {
              return mockProgress.filter((p) => !p.completed);
            }
            return mockProgress;
          },
        },
        articleTag: {
          findMany: async () => mockTagRows,
        },
      },
    },
  });

  mock.module("@/lib/profile", {
    namedExports: {
      getProfile: async () => mockProfile,
      parseTopics: (raw: string | null | undefined) => {
        if (!raw) return [];
        try {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed))
            return parsed.filter((t): t is string => typeof t === "string");
        } catch {
          /* empty */
        }
        return [];
      },
    },
  });

  // Bypass AI/heuristic difficulty assessment — test articles have difficulty set.
  mock.module("@/lib/difficulty", {
    namedExports: {
      isDifficultyLevel: (v: unknown) =>
        ["A1", "A2", "B1", "B2", "C1", "C2"].includes(v as string),
      levelRank: (v: string) =>
        ["A1", "A2", "B1", "B2", "C1", "C2"].indexOf(v),
      levelsAtOrBelow: (max: string) => {
        const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
        const i = levels.indexOf(max);
        return i < 0 ? [] : levels.slice(0, i + 1);
      },
      ensureArticleDifficulties: async () => new Map(),
      heuristicDifficulty: (_content: string) => ({ level: "B1", score: 50 }),
    },
  });
});

beforeEach(() => {
  mockArticles = [];
  mockProgress = [];
  mockTagRows = [];
  mockProfile = null;
  lastArticleFindManyArgs = null;
});

// ---------------------------------------------------------------------------
// Pure: levelProximityScore
// ---------------------------------------------------------------------------

test("levelProximityScore: perfect match returns 30 (LEVEL_PERFECT)", async () => {
  const { levelProximityScore, SCORE_WEIGHTS } = await import("@/lib/feed");
  assert.equal(levelProximityScore(2, 2), SCORE_WEIGHTS.LEVEL_PERFECT);
});

test("levelProximityScore: slightly hard penalises more than slightly easy", async () => {
  const { levelProximityScore } = await import("@/lib/feed");
  // delta=-1 (article easier than user) → score 18
  // delta=+1 (article harder than user) → score 12
  const slightlyEasy = levelProximityScore(1, 2);
  const slightlyHard = levelProximityScore(3, 2);
  assert.ok(slightlyEasy > slightlyHard, "slightly-easy should score higher than slightly-hard");
});

test("levelProximityScore: way-too-hard article returns 0", async () => {
  const { levelProximityScore } = await import("@/lib/feed");
  assert.equal(levelProximityScore(5, 0), 0); // C2 article for A1 reader
});

test("levelProximityScore: way-too-easy article returns 5 (not dropped)", async () => {
  const { levelProximityScore } = await import("@/lib/feed");
  assert.equal(levelProximityScore(0, 5), 5); // A1 article for C2 reader
});

// ---------------------------------------------------------------------------
// Pure: freshnessScore
// ---------------------------------------------------------------------------

test("freshnessScore: article within 7 days returns max freshness bonus", async () => {
  const { freshnessScore, SCORE_WEIGHTS } = await import("@/lib/feed");
  const now = new Date("2026-01-10T00:00:00Z");
  const published = new Date("2026-01-08T00:00:00Z"); // 2 days ago
  assert.equal(freshnessScore(published, now), SCORE_WEIGHTS.FRESHNESS_RECENT);
});

test("freshnessScore: article over 6 months old returns 0", async () => {
  const { freshnessScore } = await import("@/lib/feed");
  const now = new Date("2026-01-01T00:00:00Z");
  const old = new Date("2025-01-01T00:00:00Z"); // 1 year ago
  assert.equal(freshnessScore(null, now), 0);
  assert.equal(freshnessScore(old, now), 0);
});

test("freshnessScore: 16-day-old article returns intermediate value", async () => {
  const { freshnessScore, SCORE_WEIGHTS } = await import("@/lib/feed");
  const now = new Date("2026-01-31T00:00:00Z");
  const published = new Date("2026-01-15T00:00:00Z"); // 16 days ago
  const score = freshnessScore(published, now);
  assert.ok(score > 0 && score < SCORE_WEIGHTS.FRESHNESS_RECENT);
});

// ---------------------------------------------------------------------------
// Pure: buildTagMap
// ---------------------------------------------------------------------------

test("buildTagMap groups tag slugs by articleId", async () => {
  const { buildTagMap } = await import("@/lib/feed");
  const rows = [
    { articleId: "a1", tag: { slug: "tech" } },
    { articleId: "a1", tag: { slug: "ai" } },
    { articleId: "a2", tag: { slug: "health" } },
  ];
  const map = buildTagMap(rows);
  assert.deepEqual(map.get("a1")?.sort(), ["ai", "tech"]);
  assert.deepEqual(map.get("a2"), ["health"]);
  assert.equal(map.get("a3"), undefined);
});

// ---------------------------------------------------------------------------
// Pure: diversify
// ---------------------------------------------------------------------------

test("diversify defers the 4th consecutive same-category article", async () => {
  const { diversify } = await import("@/lib/feed");
  const makeScored = (id: string, category: string): ScoredArticle => ({
    article: buildArticle({ id, category }),
    score: 50,
    reason: "test",
  });
  const input = [
    makeScored("t1", "tech"),
    makeScored("t2", "tech"),
    makeScored("t3", "tech"),
    makeScored("t4", "tech"), // 4th consecutive — deferred
    makeScored("w1", "world"),
  ];
  const result = diversify(input);
  assert.deepEqual(result.map((s) => s.article.id), ["t1", "t2", "t3", "w1", "t4"]);
});

test("diversify is a no-op when categories are varied", async () => {
  const { diversify } = await import("@/lib/feed");
  const makeScored = (id: string, category: string): ScoredArticle => ({
    article: buildArticle({ id, category }),
    score: 50,
    reason: "test",
  });
  const input = [
    makeScored("a1", "tech"),
    makeScored("a2", "world"),
    makeScored("a3", "tech"),
  ];
  assert.deepEqual(diversify(input).map((s) => s.article.id), ["a1", "a2", "a3"]);
});

// ---------------------------------------------------------------------------
// Pure: scoreArticle
// ---------------------------------------------------------------------------

test("scoreArticle: returns null for completed articles (hard exclude)", async () => {
  const { scoreArticle } = await import("@/lib/feed");
  const article = buildArticle({ id: "a1", category: "tech", difficulty: "B1" });
  const ctx: ScoringContext = {
    userLevel: "B1",
    userLevelRank: 2,
    topicSet: new Set(["tech"]),
    tagSlugsForArticle: [],
    completedIds: new Set(["a1"]),
    inProgressIds: new Set(),
    now: new Date("2026-01-01"),
  };
  assert.equal(scoreArticle(article, ctx), null);
});

test("scoreArticle: topic-matched article scores higher than non-matched", async () => {
  const { scoreArticle } = await import("@/lib/feed");
  const now = new Date("2026-01-01");
  const base: ScoringContext = {
    userLevel: "B1",
    userLevelRank: 2,
    topicSet: new Set(["tech"]),
    tagSlugsForArticle: [],
    completedIds: new Set(),
    inProgressIds: new Set(),
    now,
  };
  const article = buildArticle({ id: "a1", category: "tech", difficulty: "B1" });
  const matched = scoreArticle(article, base);
  const unmatched = scoreArticle(article, { ...base, topicSet: new Set(["world"]) });
  assert.ok(matched !== null && unmatched !== null);
  assert.ok(matched.score > unmatched.score, "topic-matched ranks higher");
});

test("scoreArticle: in-progress articles receive a soft penalty", async () => {
  const { scoreArticle, SCORE_WEIGHTS } = await import("@/lib/feed");
  const now = new Date("2026-01-01");
  const base: ScoringContext = {
    userLevel: "B1",
    userLevelRank: 2,
    topicSet: new Set(),
    tagSlugsForArticle: [],
    completedIds: new Set(),
    inProgressIds: new Set(),
    now,
  };
  const article = buildArticle({ id: "a1", difficulty: "B1" });
  const normal = scoreArticle(article, base);
  const inProgress = scoreArticle(article, { ...base, inProgressIds: new Set(["a1"]) });
  assert.ok(normal !== null && inProgress !== null);
  assert.equal(
    normal.score - inProgress.score,
    SCORE_WEIGHTS.IN_PROGRESS_PENALTY,
    "in-progress penalty applied",
  );
});

// ---------------------------------------------------------------------------
// DB-backed: getPersonalizedFeed
// ---------------------------------------------------------------------------

test("getPersonalizedFeed: topic-matched articles rank before unmatched ones", async () => {
  const old = new Date("2025-06-01T00:00:00Z");
  mockArticles = [
    buildArticle({ id: "world-a", category: "world", difficulty: "B1", publishedAt: old }),
    buildArticle({ id: "tech-a", category: "tech", difficulty: "B1", publishedAt: old }),
    buildArticle({ id: "tech-b", category: "tech", difficulty: "B1", publishedAt: old }),
  ];
  mockProfile = {
    completedAt: new Date("2026-01-01"),
    englishLevel: "B1",
    topics: JSON.stringify(["tech"]),
  };

  const { getPersonalizedFeed } = await import("@/lib/feed");
  const feed = await getPersonalizedFeed("user-1", { offset: 0, limit: 10 });

  const ids = feed.articles.map((a) => a.id);
  const worldIndex = ids.indexOf("world-a");
  const techIndices = ids.filter((id) => id.startsWith("tech")).map((_, i) => ids.indexOf(ids.filter((id) => id.startsWith("tech"))[i]));
  assert.ok(techIndices.every((i) => i < worldIndex), "tech articles precede world article");
});

test("getPersonalizedFeed: completed articles are excluded from the feed", async () => {
  mockArticles = [
    buildArticle({ id: "done", category: "tech", difficulty: "B1" }),
    buildArticle({ id: "fresh", category: "world", difficulty: "B1" }),
  ];
  mockProgress = [{ articleId: "done", completed: true, percent: 100 }];
  mockProfile = {
    completedAt: new Date("2026-01-01"),
    englishLevel: "B1",
    topics: JSON.stringify(["tech"]),
  };

  const { getPersonalizedFeed } = await import("@/lib/feed");
  const feed = await getPersonalizedFeed("user-1");

  assert.ok(!feed.articles.some((a) => a.id === "done"), "completed article excluded");
  assert.ok(feed.articles.some((a) => a.id === "fresh"), "non-completed article included");
});

test("getPersonalizedFeed: no-profile fallback returns articles without erroring", async () => {
  mockArticles = [
    buildArticle({ id: "a1", difficulty: "B1" }),
    buildArticle({ id: "a2", difficulty: "A1" }),
  ];
  mockProfile = null; // user has no profile

  const { getPersonalizedFeed } = await import("@/lib/feed");
  const feed = await getPersonalizedFeed("user-no-profile");

  assert.ok(Array.isArray(feed.articles), "returns an array");
  assert.equal(feed.articles.length, 2, "fallback returns all articles");
  assert.equal(feed.hasMore, false);
});

test("getPersonalizedFeed: pagination hasMore is correct across pages", async () => {
  mockArticles = [
    buildArticle({ id: "a1", difficulty: "B1" }),
    buildArticle({ id: "a2", difficulty: "B1" }),
    buildArticle({ id: "a3", difficulty: "B1" }),
  ];
  mockProfile = {
    completedAt: new Date("2026-01-01"),
    englishLevel: "B1",
    topics: JSON.stringify([]),
  };

  const { getPersonalizedFeed } = await import("@/lib/feed");
  const page1 = await getPersonalizedFeed("user-1", { offset: 0, limit: 2 });
  assert.equal(page1.articles.length, 2);
  assert.equal(page1.hasMore, true);

  const page2 = await getPersonalizedFeed("user-1", { offset: 2, limit: 2 });
  assert.equal(page2.articles.length, 1);
  assert.equal(page2.hasMore, false);
});

test("getPersonalizedFeed: reasons map contains a non-empty entry per article", async () => {
  mockArticles = [buildArticle({ id: "a1", category: "tech", difficulty: "B1" })];
  mockProfile = {
    completedAt: new Date("2026-01-01"),
    englishLevel: "B1",
    topics: JSON.stringify(["tech"]),
  };

  const { getPersonalizedFeed } = await import("@/lib/feed");
  const feed = await getPersonalizedFeed("user-1");

  assert.ok("a1" in feed.reasons, "reason entry present for returned article");
  assert.ok(
    typeof feed.reasons["a1"] === "string" && feed.reasons["a1"].length > 0,
    "reason is a non-empty string",
  );
});

test("getPersonalizedFeed: returns empty feed when no articles exist", async () => {
  mockArticles = [];
  mockProfile = {
    completedAt: new Date("2026-01-01"),
    englishLevel: "B1",
    topics: JSON.stringify(["tech"]),
  };

  const { getPersonalizedFeed } = await import("@/lib/feed");
  const feed = await getPersonalizedFeed("user-1");
  assert.deepEqual(feed, { articles: [], hasMore: false, reasons: {} });
});

// ---------------------------------------------------------------------------
// PERF: the candidate fetch projects only needed fields (excludes `content`)
// ---------------------------------------------------------------------------

test("getPersonalizedFeed: fetch select excludes the large content field", async () => {
  mockArticles = [buildArticle({ id: "a1", category: "tech", difficulty: "B1" })];
  mockProfile = {
    completedAt: new Date("2026-01-01"),
    englishLevel: "B1",
    topics: JSON.stringify(["tech"]),
  };

  const { getPersonalizedFeed } = await import("@/lib/feed");
  await getPersonalizedFeed("user-1");

  const select = lastArticleFindManyArgs?.select;
  assert.ok(select, "article.findMany was called with a select projection");
  assert.ok(!("content" in (select as Record<string, unknown>)), "content is NOT selected");
  assert.equal((select as Record<string, unknown>).id, true);
  assert.equal((select as Record<string, unknown>).title, true);
  assert.equal((select as Record<string, unknown>).difficulty, true);
  assert.equal((select as Record<string, unknown>).difficultyScore, true);
});

// ---------------------------------------------------------------------------
// Level filter: constrains difficulty at the DB layer (IN [...])
// ---------------------------------------------------------------------------

test("getPersonalizedFeed: maxLevel constrains difficulty at the DB layer", async () => {
  mockArticles = [buildArticle({ id: "a1", category: "tech", difficulty: "A2" })];
  mockProfile = {
    completedAt: new Date("2026-01-01"),
    englishLevel: "B1",
    topics: JSON.stringify(["tech"]),
  };

  const { getPersonalizedFeed } = await import("@/lib/feed");
  await getPersonalizedFeed("user-1", { offset: 0, limit: 10, maxLevel: "B1" });

  const where = lastArticleFindManyArgs?.where as
    | { difficulty?: { in?: string[] } }
    | undefined;
  assert.ok(where?.difficulty?.in, "difficulty IN filter applied");
  assert.deepEqual(where!.difficulty!.in, ["A1", "A2", "B1"]);
});
