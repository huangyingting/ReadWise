/**
 * Weak-word re-exposure (#808).
 *
 * Covers the deterministic (no-AI) first increment that connects saved-word
 * weakness to future reading:
 *
 *   1. Recommendation scoring prefers articles that re-expose the learner's weak
 *      words — as a SOFT, capped booster that never starves strong content or
 *      overwhelms word load.
 *   2. No-saved-words / no-overlap degrades gracefully to a pure no-op.
 *   3. Real reading exposure updates word mastery (familiarity can grow from
 *      reading, not only flashcards), user-scoped + fully defensive.
 *   4. PRIVACY: the recommendation explanation and the Today explanation carry
 *      ONLY flags/counts — never any word text.
 *
 * The pure scoring assertions construct a RecommendationContext directly (no DB).
 * The reading-exposure assertions drive a fully-mocked Prisma + in-memory
 * WordMastery store; the lexical lemmatizer runs for real.
 */
process.env.LOG_LEVEL = "error"; // silence best-effort warn logs

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  makeRecommendationCandidate as candidate,
  makeRecommendationContext as baseContext,
} from "./support/learning-fixtures";
import type { TodaySessionView } from "@/lib/engagement/today-session/types";
import type { TodayArticleDisplays } from "@/lib/engagement/today-session/view-model";
import type { ListingArticle } from "@/lib/article-library";

// ---------------------------------------------------------------------------
// Local Today fixtures (no DB) — anchors/ids only.
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<TodaySessionView> = {}): TodaySessionView {
  return {
    id: "ts1",
    userId: "user-1",
    localDate: "2026-06-27",
    timezoneSnapshot: "UTC",
    primaryArticleId: "a1",
    backupArticleIds: [],
    targetSavedWordIds: [],
    reviewTargetCount: 0,
    status: "active",
    source: "picks",
    completionTier: "none",
    generationReasonCode: "picks_primary",
    readingCompletedAt: null,
    comprehensionCompletedAt: null,
    wordReviewCompletedAt: null,
    completedAt: null,
    skipped: false,
    skipReason: null,
    skippedAt: null,
    createdAt: new Date("2026-06-27T00:00:00Z"),
    updatedAt: new Date("2026-06-27T00:00:00Z"),
    ...overrides,
  };
}

function card(id: string): ListingArticle {
  return {
    id,
    title: `Title ${id}`,
    author: null,
    source: null,
    category: "tech",
    difficulty: "B1",
    readingMinutes: 4,
    publishedAt: null,
    heroImage: null,
  };
}

const displays = (primaryId: string | null): TodayArticleDisplays => ({
  primary: primaryId ? card(primaryId) : null,
  backups: [],
});

// ---------------------------------------------------------------------------
// In-memory Prisma state (savedWord + article + wordMastery store)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

let savedWords: Array<{ word: string }> = [];
let articleContent: string | null = null;
let savedWordThrows = false;
let masteryStore: Map<string, Row>;

const keyOf = (userId: string, lemma: string) => `${userId}::${lemma}`;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        savedWord: {
          findMany: async () => {
            if (savedWordThrows) throw new Error("boom");
            return savedWords;
          },
        },
        article: {
          findUnique: async () =>
            articleContent === null ? null : { content: articleContent },
        },
        wordMastery: {
          findUnique: async ({
            where,
          }: {
            where: { userId_lemma: { userId: string; lemma: string } };
          }) => {
            const { userId, lemma } = where.userId_lemma;
            return masteryStore.get(keyOf(userId, lemma)) ?? null;
          },
          upsert: async ({
            where,
            create,
            update,
          }: {
            where: { userId_lemma: { userId: string; lemma: string } };
            create: Row;
            update: Row;
          }) => {
            const { userId, lemma } = where.userId_lemma;
            const k = keyOf(userId, lemma);
            const existing = masteryStore.get(k);
            const row = existing ? { ...existing, ...update } : { ...create };
            masteryStore.set(k, row);
            return row;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  savedWords = [];
  articleContent = null;
  savedWordThrows = false;
  masteryStore = new Map();
});

// ---------------------------------------------------------------------------
// 1. Recommendation scoring — soft, capped weak-word re-exposure booster
// ---------------------------------------------------------------------------

test("scoring: weak-word overlap article outranks an otherwise-identical plain one", async () => {
  const { scoreCandidate } = await import("@/lib/recommendations/scoring");

  const ctx = baseContext({
    weakWordArticleIds: new Map([["a-overlap", 3]]),
  });
  const overlap = scoreCandidate(candidate({ id: "a-overlap" }), ctx);
  const plain = scoreCandidate(candidate({ id: "a-plain" }), ctx);

  assert.equal(overlap.weakWordReexposure.count, 3);
  assert.ok(overlap.weakWordReexposure.points > 0, "overlap earns a bonus");
  assert.equal(plain.weakWordReexposure.count, 0);
  assert.equal(plain.weakWordReexposure.points, 0);
  assert.ok(overlap.baseScore > plain.baseScore, "overlap ranks higher");
});

test("scoring: booster is CAPPED so it cannot overwhelm word load / starve content", async () => {
  const { scoreCandidate } = await import("@/lib/recommendations/scoring");
  const { WEAK_WORD_REEXPOSURE_MAX_POINTS } = await import(
    "@/lib/recommendations/types"
  );

  // A huge overlap count must not scale beyond the cap.
  const ctx = baseContext({ weakWordArticleIds: new Map([["a-dense", 99]]) });
  const dense = scoreCandidate(candidate({ id: "a-dense" }), ctx);
  assert.ok(
    dense.weakWordReexposure.points <= WEAK_WORD_REEXPOSURE_MAX_POINTS,
    `points ${dense.weakWordReexposure.points} <= cap`,
  );
  assert.equal(dense.weakWordReexposure.score, 1, "saturated at 1");

  // The bonus is bounded, so a much stronger plain article (great topic + level
  // fit) still outranks a weakly-fitting overlap article — content is not starved.
  const fitCtx = baseContext({
    userLevel: "B1",
    userLevelRank: 2,
    topicSet: new Set(["science"]),
    weakWordArticleIds: new Map([["a-poorfit-overlap", 99]]),
  });
  const strongPlain = scoreCandidate(
    candidate({ id: "a-strong", category: "science", difficulty: "B1" }),
    fitCtx,
  );
  const poorOverlap = scoreCandidate(
    candidate({ id: "a-poorfit-overlap", category: "sports", difficulty: "C2" }),
    fitCtx,
  );
  assert.ok(
    strongPlain.baseScore > poorOverlap.baseScore,
    `strong plain ${strongPlain.baseScore} should beat poor overlap ${poorOverlap.baseScore}`,
  );
});

test("scoring: no weak words → graceful no-op (zeroed booster, 7 explanation lines)", async () => {
  const { scoreCandidate } = await import("@/lib/recommendations/scoring");

  const ctx = baseContext(); // empty weakWordArticleIds from the fixture
  const r = scoreCandidate(candidate({ id: "a1" }), ctx);

  assert.equal(r.weakWordReexposure.count, 0);
  assert.equal(r.weakWordReexposure.points, 0);
  // No extra explanation line is appended when there is no overlap.
  assert.equal(r.explanation.length, 7);
  assert.ok(r.baseScore >= 0 && r.baseScore <= 100);
});

test("scoring: weakWordReexposureSignal is pure and saturates at the target", async () => {
  const { weakWordReexposureSignal } = await import(
    "@/lib/recommendations/scoring"
  );
  const map = new Map([["a", 1], ["b", 3], ["c", 10]]);
  assert.equal(weakWordReexposureSignal("missing", map).count, 0);
  assert.equal(weakWordReexposureSignal("missing", map).points, 0);
  assert.ok(weakWordReexposureSignal("a", map).score < weakWordReexposureSignal("b", map).score);
  assert.equal(weakWordReexposureSignal("b", map).score, 1);
  assert.equal(weakWordReexposureSignal("c", map).score, 1, "clamped at the target");
});

// ---------------------------------------------------------------------------
// 2. Reading exposure → word mastery
// ---------------------------------------------------------------------------

test("reading exposure: saved words appearing in the article gain a mastery exposure", async () => {
  const { recordReadingWordExposures } = await import(
    "@/lib/learning/reading-exposure"
  );

  savedWords = [
    { word: "benevolent" },
    { word: "running" }, // lemma `run` should still match `ran`/`runs`
    { word: "absent-word" }, // never appears
  ];
  articleContent =
    "The benevolent mentor kept running every morning before class.";

  const recorded = await recordReadingWordExposures("user-1", "art-1");
  assert.equal(recorded, 2, "two saved words were present in the text");

  const { estimateFamiliarity } = await import("@/lib/learning/word-mastery");
  assert.ok(
    (await estimateFamiliarity("user-1", "benevolent")) > 0,
    "familiarity improved from real reading",
  );
  assert.ok((await estimateFamiliarity("user-1", "running")) > 0);
  assert.equal(
    await estimateFamiliarity("user-1", "absent-word"),
    0,
    "absent saved word is not exposed",
  );
});

test("reading exposure: no saved words → no-op (returns 0)", async () => {
  const { recordReadingWordExposures } = await import(
    "@/lib/learning/reading-exposure"
  );
  savedWords = [];
  articleContent = "Plenty of text here.";
  assert.equal(await recordReadingWordExposures("user-1", "art-1"), 0);
});

test("reading exposure: defensive — missing content and DB errors never throw", async () => {
  const { recordReadingWordExposures } = await import(
    "@/lib/learning/reading-exposure"
  );

  savedWords = [{ word: "benevolent" }];
  articleContent = null; // article not found / no body
  assert.equal(await recordReadingWordExposures("user-1", "art-1"), 0);

  savedWordThrows = true; // simulate a DB failure
  articleContent = "benevolent text";
  assert.equal(
    await recordReadingWordExposures("user-1", "art-1"),
    0,
    "swallows errors instead of throwing into the reading flow",
  );
});

// ---------------------------------------------------------------------------
// 3. PRIVACY — explanations/analytics payloads carry only flags + counts
// ---------------------------------------------------------------------------

test("privacy: recommendation explanation exposes counts only, never word text", async () => {
  const { scoreCandidate } = await import("@/lib/recommendations/scoring");

  const ctx = baseContext({ weakWordArticleIds: new Map([["a-overlap", 2]]) });
  const r = scoreCandidate(candidate({ id: "a-overlap" }), ctx);

  // The breakdown is numbers only.
  assert.deepEqual(Object.keys(r.weakWordReexposure).sort(), [
    "count",
    "points",
    "score",
  ]);
  for (const v of Object.values(r.weakWordReexposure)) {
    assert.equal(typeof v, "number");
  }

  // The appended explanation line references a count, not any saved word.
  const line = r.explanation.find((l) => /weak-word re-exposure/.test(l));
  assert.ok(line, "weak-word explanation line present");
  assert.match(line!, /weak-word re-exposure: \+\d/);
  assert.match(line!, /\d saved words?/);
});

test("privacy: Today view-model exposes reviewsSavedWords flag + count, no word text", async () => {
  const { buildTodayViewModel } = await import(
    "@/lib/engagement/today-session/view-model"
  );

  const vm = buildTodayViewModel(
    makeSession({ targetSavedWordIds: ["sw-aaa", "sw-bbb"], reviewTargetCount: 2 }),
    "UTC",
    displays("a1"),
  );

  assert.equal(vm.reviewsSavedWords, true);
  assert.equal(vm.savedWordCount, 2);
  assert.equal(typeof vm.savedWordCount, "number");

  // The serialized view model must not leak the underlying saved-word ids/text.
  const json = JSON.stringify(vm);
  assert.ok(!json.includes("sw-aaa") && !json.includes("sw-bbb"));

  const none = buildTodayViewModel(makeSession(), "UTC", displays("a1"));
  assert.equal(none.reviewsSavedWords, false);
  assert.equal(none.savedWordCount, 0);
});
