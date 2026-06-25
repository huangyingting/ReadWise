/**
 * Tests for word mastery lib (RW-036).
 *
 * Mocks: @/lib/prisma (in-memory wordMastery store). The dictionary lemmatizer
 * lexical normalization and scoring helpers run for real — no DB or
 * network is touched.
 */
process.env.LOG_LEVEL = "error"; // silence best-effort warn logs

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// In-memory wordMastery store
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
let store: Map<string, Row>;

const keyOf = (userId: string, lemma: string) => `${userId}::${lemma}`;

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        wordMastery: {
          findUnique: async ({ where }: { where: { userId_lemma: { userId: string; lemma: string } } }) => {
            const { userId, lemma } = where.userId_lemma;
            return store.get(keyOf(userId, lemma)) ?? null;
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
            const existing = store.get(k);
            const row = existing ? { ...existing, ...update } : { ...create };
            store.set(k, row);
            return row;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  store = new Map();
});

// ---------------------------------------------------------------------------
// Pure scoring helpers
// ---------------------------------------------------------------------------

test("computeFamiliarity: exposure-only saturates toward a 0.6 ceiling", async () => {
  const { computeFamiliarity } = await import("@/lib/learning/word-mastery");
  assert.equal(computeFamiliarity(0, 0, 0), 0);
  const one = computeFamiliarity(1, 0, 0);
  const many = computeFamiliarity(50, 0, 0);
  assert.ok(one > 0 && one < 0.3, `one exposure ${one}`);
  assert.ok(many > 0.55 && many <= 0.6, `many exposures ${many}`);
});

test("computeFamiliarity: correct reviews raise, incorrect reviews lower the score", async () => {
  const { computeFamiliarity } = await import("@/lib/learning/word-mastery");
  const allCorrect = computeFamiliarity(5, 5, 0);
  const allWrong = computeFamiliarity(5, 0, 5);
  assert.ok(allCorrect > allWrong, `${allCorrect} > ${allWrong}`);
  assert.ok(allCorrect > 0.6, "demonstrated recall beats the exposure ceiling");
});

test("computeConfidence grows with total evidence", async () => {
  const { computeConfidence } = await import("@/lib/learning/word-mastery");
  assert.equal(computeConfidence(0, 0, 0), 0);
  assert.ok(computeConfidence(10, 0, 0) > computeConfidence(1, 0, 0));
});

test("lemmaFor normalizes case, possessives and trailing punctuation to one key", async () => {
  const { lemmaFor } = await import("@/lib/learning/word-mastery");
  assert.equal(lemmaFor("Test"), "test");
  assert.equal(lemmaFor("test."), "test");
  assert.equal(lemmaFor("dog's"), "dog");
  assert.equal(lemmaFor("   "), "");
});

// ---------------------------------------------------------------------------
// recordWordExposure
// ---------------------------------------------------------------------------

test("recordWordExposure: a new word starts with one exposure and no reviews", async () => {
  const { recordWordExposure } = await import("@/lib/learning/word-mastery");
  const rec = await recordWordExposure("u1", "serendipity");
  assert.ok(rec);
  assert.equal(rec!.lemma, "serendipity");
  assert.equal(rec!.exposures, 1);
  assert.equal(rec!.correctReviews, 0);
  assert.equal(rec!.incorrectReviews, 0);
  assert.equal(rec!.lastReviewedAt, null);
  assert.ok(rec!.familiarity > 0, "exposure gives some familiarity");
  assert.ok(rec!.confidence > 0);
});

test("recordWordExposure: records the source article id (bounded, most-recent-first)", async () => {
  const { recordWordExposure } = await import("@/lib/learning/word-mastery");
  await recordWordExposure("u1", "ephemeral", { articleId: "a1" });
  const rec = await recordWordExposure("u1", "ephemeral", { articleId: "a2" });
  assert.deepEqual(rec!.sourceArticleIds, ["a2", "a1"]);
  assert.equal(rec!.exposures, 2);
});

test("repeated encounters of inflections collapse onto a single lemma row", async () => {
  const { recordWordExposure, getWordMastery } = await import("@/lib/learning/word-mastery");
  await recordWordExposure("u1", "Test");
  await recordWordExposure("u1", "test");
  await recordWordExposure("u1", "test.");
  assert.equal(store.size, 1, "all map to one row");
  const rec = await getWordMastery("u1", "TEST");
  assert.equal(rec!.exposures, 3);
});

// ---------------------------------------------------------------------------
// recordWordReview
// ---------------------------------------------------------------------------

test("recordWordReview(correct) increments correctReviews and sets lastReviewedAt", async () => {
  const { recordWordReview } = await import("@/lib/learning/word-mastery");
  const rec = await recordWordReview("u1", "lucid", true);
  assert.equal(rec!.correctReviews, 1);
  assert.equal(rec!.incorrectReviews, 0);
  assert.equal(rec!.exposures, 1, "a review is also an exposure");
  assert.ok(rec!.lastReviewedAt instanceof Date);
});

test("recordWordReview(incorrect) increments incorrectReviews", async () => {
  const { recordWordReview } = await import("@/lib/learning/word-mastery");
  const rec = await recordWordReview("u1", "lucid", false);
  assert.equal(rec!.correctReviews, 0);
  assert.equal(rec!.incorrectReviews, 1);
});

test("a correct review raises familiarity above a failed one for the same word", async () => {
  const { recordWordReview } = await import("@/lib/learning/word-mastery");
  const good = await recordWordReview("u-good", "verbose", true);
  const bad = await recordWordReview("u-bad", "verbose", false);
  assert.ok(good!.familiarity > bad!.familiarity, `${good!.familiarity} > ${bad!.familiarity}`);
});

// ---------------------------------------------------------------------------
// getWordMastery / estimateFamiliarity
// ---------------------------------------------------------------------------

test("getWordMastery returns null for a never-seen word", async () => {
  const { getWordMastery } = await import("@/lib/learning/word-mastery");
  assert.equal(await getWordMastery("u1", "unheard"), null);
});

test("estimateFamiliarity works even when the word is not in the saved study list", async () => {
  const { recordWordExposure, estimateFamiliarity } = await import("@/lib/learning/word-mastery");
  // No SavedWord row exists; mastery is tracked purely from exposure.
  assert.equal(await estimateFamiliarity("u1", "nascent"), 0, "unknown → 0");
  await recordWordExposure("u1", "nascent");
  const est = await estimateFamiliarity("u1", "nascent");
  assert.ok(est > 0, `seen word estimates > 0 (${est})`);
});
