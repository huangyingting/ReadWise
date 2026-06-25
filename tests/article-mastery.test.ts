/**
 * Tests for article mastery lib (RW-037).
 *
 * Mocks: @/lib/prisma (controllable source signals + in-memory articleMastery
 * store). The comprehension scoring runs for real — no DB or network touched.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Controllable source signals + in-memory articleMastery store
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
let amStore: Map<string, Row>;

// Source signal stubs (per test).
let progressPercent: number | null; // ReadingProgress.percent
let maxScorePct: number | null; // QuizAttempt._max.scorePct
let savedCount: number; // SavedWord.count
let wordCount: number | null; // Article.wordCount
let feedbackVote: string | null; // ArticleDifficultyFeedback.vote

const keyOf = (userId: string, articleId: string) => `${userId}::${articleId}`;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        readingProgress: {
          findUnique: async () =>
            progressPercent == null ? null : { percent: progressPercent },
        },
        quizAttempt: {
          aggregate: async () => ({ _max: { scorePct: maxScorePct } }),
        },
        savedWord: {
          count: async () => savedCount,
        },
        article: {
          findUnique: async () => (wordCount == null ? { wordCount: null } : { wordCount }),
        },
        articleDifficultyFeedback: {
          findUnique: async () => (feedbackVote == null ? null : { vote: feedbackVote }),
        },
        articleMastery: {
          findUnique: async ({
            where,
          }: {
            where: { userId_articleId: { userId: string; articleId: string } };
          }) => {
            const { userId, articleId } = where.userId_articleId;
            return amStore.get(keyOf(userId, articleId)) ?? null;
          },
          upsert: async ({
            where,
            create,
            update,
          }: {
            where: { userId_articleId: { userId: string; articleId: string } };
            create: Row;
            update: Row;
          }) => {
            const { userId, articleId } = where.userId_articleId;
            const k = keyOf(userId, articleId);
            const existing = amStore.get(k);
            const row = existing
              ? { ...existing, ...update }
              : { userId, articleId, ...create };
            amStore.set(k, row);
            return row;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  amStore = new Map();
  progressPercent = null;
  maxScorePct = null;
  savedCount = 0;
  wordCount = null;
  feedbackVote = null;
});

// ---------------------------------------------------------------------------
// computeComprehensionScore (pure)
// ---------------------------------------------------------------------------

test("computeComprehensionScore: reading alone is capped (no quiz)", async () => {
  const { computeComprehensionScore } = await import("@/lib/learning/article-mastery");
  const full = computeComprehensionScore({
    readingCompletion: 1,
    quizScore: null,
    lookupDensity: null,
    difficultyFeedback: null,
  });
  assert.ok(Math.abs(full - 0.6) < 1e-9, `completed read without quiz → 0.6 (${full})`);
});

test("computeComprehensionScore: a quiz is the strongest comprehension signal", async () => {
  const { computeComprehensionScore } = await import("@/lib/learning/article-mastery");
  const pass = computeComprehensionScore({
    readingCompletion: 1,
    quizScore: 0.9,
    lookupDensity: null,
    difficultyFeedback: null,
  });
  assert.ok(Math.abs(pass - 0.95) < 1e-9, `0.5*1 + 0.5*0.9 = 0.95 (${pass})`);
});

test("computeComprehensionScore: too_hard lowers, too_easy raises", async () => {
  const { computeComprehensionScore } = await import("@/lib/learning/article-mastery");
  const base = { readingCompletion: 1, quizScore: 0.8, lookupDensity: null };
  const neutral = computeComprehensionScore({ ...base, difficultyFeedback: null });
  const hard = computeComprehensionScore({ ...base, difficultyFeedback: "too_hard" });
  const easy = computeComprehensionScore({ ...base, difficultyFeedback: "too_easy" });
  assert.ok(hard < neutral, `${hard} < ${neutral}`);
  assert.ok(easy > neutral, `${easy} > ${neutral}`);
});

// ---------------------------------------------------------------------------
// updateArticleMastery (integration of source signals)
// ---------------------------------------------------------------------------

test("partial read without a quiz yields a low comprehension score", async () => {
  const { updateArticleMastery } = await import("@/lib/learning/article-mastery");
  progressPercent = 40;
  const rec = await updateArticleMastery("u1", "a1");
  assert.ok(Math.abs(rec!.readingCompletion - 0.4) < 1e-9);
  assert.equal(rec!.quizScore, null);
  assert.ok(Math.abs(rec!.comprehensionScore - 0.24) < 1e-9, `0.4*0.6 = 0.24 (${rec!.comprehensionScore})`);
});

test("completed read without a quiz reaches the reading-only ceiling", async () => {
  const { updateArticleMastery } = await import("@/lib/learning/article-mastery");
  progressPercent = 100;
  const rec = await updateArticleMastery("u1", "a1");
  assert.ok(Math.abs(rec!.comprehensionScore - 0.6) < 1e-9, `(${rec!.comprehensionScore})`);
});

test("a passing quiz pushes comprehension high; a failing quiz keeps it modest", async () => {
  const { updateArticleMastery } = await import("@/lib/learning/article-mastery");
  progressPercent = 100;
  maxScorePct = 90;
  const pass = await updateArticleMastery("u-pass", "a1");
  assert.ok(Math.abs(pass!.quizScore! - 0.9) < 1e-9);
  assert.ok(pass!.comprehensionScore > 0.9, `pass ${pass!.comprehensionScore}`);

  maxScorePct = 20;
  const fail = await updateArticleMastery("u-fail", "a1");
  assert.ok(fail!.comprehensionScore < pass!.comprehensionScore, "fail < pass");
});

test("lookup density applies a bounded penalty", async () => {
  const { updateArticleMastery } = await import("@/lib/learning/article-mastery");
  progressPercent = 100;
  maxScorePct = 100;
  wordCount = 100;
  savedCount = 0;
  const clean = await updateArticleMastery("u1", "a1");
  savedCount = 10; // density 10 lookups / 100 words
  const heavy = await updateArticleMastery("u2", "a1");
  assert.ok(heavy!.lookupDensity! > 0);
  assert.ok(heavy!.comprehensionScore < clean!.comprehensionScore, "density lowers score");
});

test("difficulty feedback recomputes and persists into the same row", async () => {
  const { updateArticleMastery, getArticleMastery } = await import("@/lib/learning/article-mastery");
  progressPercent = 100;
  maxScorePct = 80;
  const before = await updateArticleMastery("u1", "a1");
  feedbackVote = "too_hard";
  const after = await updateArticleMastery("u1", "a1");
  assert.equal(after!.difficultyFeedback, "too_hard");
  assert.ok(after!.comprehensionScore < before!.comprehensionScore);
  assert.equal(amStore.size, 1, "updates the same row, not a new one");

  const fetched = await getArticleMastery("u1", "a1");
  assert.equal(fetched!.difficultyFeedback, "too_hard");
});

test("getArticleMastery returns null when nothing recorded", async () => {
  const { getArticleMastery } = await import("@/lib/learning/article-mastery");
  assert.equal(await getArticleMastery("u1", "missing"), null);
});
