/**
 * Today Session — completion tier engine + integrations (#792, #793, #794, #795).
 *
 * Covers:
 *   - the pure tier truth table (every combination of satisfied dimensions →
 *     expected tier + completed/incomplete status), including best-available
 *     (zero target words) cases and monotonic no-downgrade behaviour;
 *   - reading completion (auto threshold, manual fallback, idempotency, primary
 *     scoping, IDOR);
 *   - comprehension completion from quiz / difficulty feedback paths;
 *   - word-review completion from flashcard grading (threshold + deleted-target
 *     graceful handling + non-target words);
 *   - a privacy assertion that completion writes carry ids/timestamps/flags only.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// ---- mutable mock state ---------------------------------------------------

type Row = Record<string, unknown>;

let sessionRow: Row | null = null;
let savedWords: Array<{ id: string; userId: string; lastReviewedAt: Date | null }> = [];
let profileTimezone: string | null = "UTC";
let updateData: Row[] = [];

const NOW = new Date("2026-06-27T12:00:00Z");
const LOCAL_DATE = "2026-06-27";
const CREATED_AT = new Date("2026-06-27T00:00:00Z");

function makeRow(overrides: Row = {}): Row {
  return {
    id: "ts1",
    userId: "u1",
    localDate: LOCAL_DATE,
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
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        profile: {
          findUnique: async () =>
            profileTimezone === null ? null : { timezone: profileTimezone },
        },
        todaySession: {
          findUnique: async ({
            where,
          }: {
            where: { userId_localDate: { userId: string; localDate: string } };
          }) => {
            const k = where.userId_localDate;
            if (!sessionRow) return null;
            if (sessionRow.userId === k.userId && sessionRow.localDate === k.localDate) {
              return { ...sessionRow };
            }
            return null;
          },
          updateMany: async ({
            where,
            data,
          }: {
            where: { userId: string; localDate: string };
            data: Row;
          }) => {
            if (
              !sessionRow ||
              sessionRow.userId !== where.userId ||
              sessionRow.localDate !== where.localDate
            ) {
              return { count: 0 };
            }
            updateData.push({ ...data });
            Object.assign(sessionRow, data);
            return { count: 1 };
          },
        },
        savedWord: {
          findMany: async ({
            where,
          }: {
            where: { userId: string; id: { in: string[] } };
          }) => {
            const ids = where.id.in;
            return savedWords
              .filter((w) => w.userId === where.userId && ids.includes(w.id))
              .map((w) => ({ id: w.id, lastReviewedAt: w.lastReviewedAt }));
          },
        },
      },
    },
  });
});

beforeEach(() => {
  sessionRow = null;
  savedWords = [];
  profileTimezone = "UTC";
  updateData = [];
});

const importCompletion = () => import("@/lib/engagement/today-session/completion");

// ===========================================================================
// Pure tier engine — truth table
// ===========================================================================

test("computeCompletionTier: none until reading is complete", async () => {
  const { computeCompletionTier } = await importCompletion();
  assert.equal(
    computeCompletionTier({ reading: false, comprehension: false, wordReview: false, hasTargetWords: false }),
    "none",
  );
  assert.equal(
    computeCompletionTier({ reading: false, comprehension: true, wordReview: true, hasTargetWords: true }),
    "none",
  );
});

test("computeCompletionTier: reading-only → reading", async () => {
  const { computeCompletionTier } = await importCompletion();
  assert.equal(
    computeCompletionTier({ reading: true, comprehension: false, wordReview: false, hasTargetWords: true }),
    "reading",
  );
});

test("computeCompletionTier: reading + comprehension → comprehension (review pending with targets)", async () => {
  const { computeCompletionTier } = await importCompletion();
  assert.equal(
    computeCompletionTier({ reading: true, comprehension: true, wordReview: false, hasTargetWords: true }),
    "comprehension",
  );
});

test("computeCompletionTier: all three with targets → full", async () => {
  const { computeCompletionTier } = await importCompletion();
  assert.equal(
    computeCompletionTier({ reading: true, comprehension: true, wordReview: true, hasTargetWords: true }),
    "full",
  );
});

test("computeCompletionTier: no target words caps best tier at comprehension", async () => {
  const { computeCompletionTier } = await importCompletion();
  assert.equal(
    computeCompletionTier({ reading: true, comprehension: true, wordReview: false, hasTargetWords: false }),
    "comprehension",
  );
  // wordReview is irrelevant when there are no target words.
  assert.equal(
    computeCompletionTier({ reading: true, comprehension: true, wordReview: true, hasTargetWords: false }),
    "comprehension",
  );
});

test("isBestAvailableComplete: needs review only when targets exist", async () => {
  const { isBestAvailableComplete } = await importCompletion();
  // With targets: requires review.
  assert.equal(isBestAvailableComplete({ reading: true, comprehension: true, wordReview: false, hasTargetWords: true }), false);
  assert.equal(isBestAvailableComplete({ reading: true, comprehension: true, wordReview: true, hasTargetWords: true }), true);
  // Without targets: comprehension is best available.
  assert.equal(isBestAvailableComplete({ reading: true, comprehension: true, wordReview: false, hasTargetWords: false }), true);
  // Missing reading or comprehension is never complete.
  assert.equal(isBestAvailableComplete({ reading: true, comprehension: false, wordReview: true, hasTargetWords: false }), false);
  assert.equal(isBestAvailableComplete({ reading: false, comprehension: true, wordReview: true, hasTargetWords: false }), false);
});

test("deriveCompletionState: sets completed + completedAt at best-available tier", async () => {
  const { deriveCompletionState } = await importCompletion();
  const d = deriveCompletionState(
    { completionTier: "reading", status: "active", completedAt: null },
    { reading: true, comprehension: true, wordReview: false, hasTargetWords: false },
    NOW,
  );
  assert.equal(d.completionTier, "comprehension");
  assert.equal(d.status, "completed");
  assert.equal(d.completedAt?.getTime(), NOW.getTime());
  assert.equal(d.changed, true);
});

test("deriveCompletionState: monotonic — never downgrades a completed session", async () => {
  const { deriveCompletionState } = await importCompletion();
  const prior = new Date("2026-06-27T06:00:00Z");
  const d = deriveCompletionState(
    { completionTier: "full", status: "completed", completedAt: prior },
    // Inputs that would compute a lower tier must not downgrade.
    { reading: true, comprehension: false, wordReview: false, hasTargetWords: true },
    NOW,
  );
  assert.equal(d.completionTier, "full");
  assert.equal(d.status, "completed");
  assert.equal(d.completedAt?.getTime(), prior.getTime(), "keeps original completedAt");
});

test("deriveCompletionState: leaves a skipped session untouched", async () => {
  const { deriveCompletionState } = await importCompletion();
  const d = deriveCompletionState(
    { completionTier: "none", status: "skipped", completedAt: null },
    { reading: true, comprehension: true, wordReview: true, hasTargetWords: true },
    NOW,
  );
  assert.equal(d.status, "skipped");
  assert.equal(d.completedAt, null);
  assert.equal(d.changed, false);
});

// ===========================================================================
// #793 Reading completion
// ===========================================================================

test("reading: auto-completes from progress at/over threshold", async () => {
  const { syncTodayReadingFromProgress } = await importCompletion();
  sessionRow = makeRow();
  const view = await syncTodayReadingFromProgress({
    userId: "u1",
    articleId: "a1",
    percent: 96,
    completed: false,
    now: NOW,
  });
  assert.ok(view);
  assert.equal((view!.readingCompletedAt as Date | null)?.getTime?.(), NOW.getTime());
  assert.equal(view!.completionTier, "reading");
  assert.equal(view!.status, "active");
});

test("reading: below threshold and not completed is a no-op", async () => {
  const { syncTodayReadingFromProgress } = await importCompletion();
  sessionRow = makeRow();
  const view = await syncTodayReadingFromProgress({
    userId: "u1",
    articleId: "a1",
    percent: 50,
    completed: false,
    now: NOW,
  });
  assert.equal(view, null);
  assert.equal(sessionRow.readingCompletedAt, null);
});

test("reading: only the current primary article can complete the step", async () => {
  const { markTodayReadingComplete } = await importCompletion();
  sessionRow = makeRow({ primaryArticleId: "a1" });
  const view = await markTodayReadingComplete({ userId: "u1", articleId: "other", now: NOW });
  assert.equal(view, null);
  assert.equal(sessionRow.readingCompletedAt, null);
});

test("reading: idempotent — repeated completion keeps the first timestamp", async () => {
  const { markTodayReadingComplete } = await importCompletion();
  const first = new Date("2026-06-27T08:00:00Z");
  sessionRow = makeRow({ readingCompletedAt: first, completionTier: "reading" });
  const view = await markTodayReadingComplete({ userId: "u1", articleId: "a1", now: NOW });
  assert.ok(view);
  assert.equal((view!.readingCompletedAt as Date).getTime(), first.getTime());
  // No write that overwrites readingCompletedAt.
  for (const d of updateData) {
    assert.equal(Object.prototype.hasOwnProperty.call(d, "readingCompletedAt"), false);
  }
});

test("reading: manual fallback completes the current primary and never touches ReadingProgress", async () => {
  const { markTodayReadingCompleteManual } = await importCompletion();
  sessionRow = makeRow({ primaryArticleId: "a1" });
  const view = await markTodayReadingCompleteManual({ userId: "u1", now: NOW });
  assert.ok(view);
  assert.equal((view!.readingCompletedAt as Date).getTime(), NOW.getTime());
  // Mock prisma has no readingProgress delegate at all — proves no RP access.
});

test("reading: manual fallback is a no-op on a no-candidate day (no primary)", async () => {
  const { markTodayReadingCompleteManual } = await importCompletion();
  sessionRow = makeRow({ primaryArticleId: null });
  const view = await markTodayReadingCompleteManual({ userId: "u1", now: NOW });
  assert.equal(view, null);
});

test("reading: IDOR — another user cannot complete this session", async () => {
  const { markTodayReadingComplete } = await importCompletion();
  sessionRow = makeRow({ userId: "u1", primaryArticleId: "a1" });
  const view = await markTodayReadingComplete({ userId: "attacker", articleId: "a1", now: NOW });
  assert.equal(view, null);
  assert.equal(sessionRow.readingCompletedAt, null, "victim session untouched");
});

test("reading: no-op when no Today session exists", async () => {
  const { markTodayReadingComplete } = await importCompletion();
  sessionRow = null;
  const view = await markTodayReadingComplete({ userId: "u1", articleId: "a1", now: NOW });
  assert.equal(view, null);
});

// ===========================================================================
// #794 Comprehension completion
// ===========================================================================

test("comprehension: completes from a quiz/difficulty action on the primary article", async () => {
  const { markTodayComprehensionComplete } = await importCompletion();
  // Reading already done so comprehension advances the tier to comprehension.
  sessionRow = makeRow({ readingCompletedAt: new Date("2026-06-27T07:00:00Z"), completionTier: "reading" });
  const view = await markTodayComprehensionComplete({ userId: "u1", articleId: "a1", now: NOW });
  assert.ok(view);
  assert.equal((view!.comprehensionCompletedAt as Date).getTime(), NOW.getTime());
  assert.equal(view!.completionTier, "comprehension");
  // No target words → comprehension is best available → session completes.
  assert.equal(view!.status, "completed");
  assert.equal((view!.completedAt as Date).getTime(), NOW.getTime());
});

test("comprehension: no-op on a non-primary article", async () => {
  const { markTodayComprehensionComplete } = await importCompletion();
  sessionRow = makeRow({ primaryArticleId: "a1" });
  const view = await markTodayComprehensionComplete({ userId: "u1", articleId: "other", now: NOW });
  assert.equal(view, null);
  assert.equal(sessionRow.comprehensionCompletedAt, null);
});

test("comprehension: idempotent — keeps the first timestamp", async () => {
  const { markTodayComprehensionComplete } = await importCompletion();
  const first = new Date("2026-06-27T08:00:00Z");
  sessionRow = makeRow({ comprehensionCompletedAt: first });
  const view = await markTodayComprehensionComplete({ userId: "u1", articleId: "a1", now: NOW });
  assert.ok(view);
  assert.equal((view!.comprehensionCompletedAt as Date).getTime(), first.getTime());
  for (const d of updateData) {
    assert.equal(Object.prototype.hasOwnProperty.call(d, "comprehensionCompletedAt"), false);
  }
});

// ===========================================================================
// #795 Word-review completion
// ===========================================================================

test("word-review: completes when all targets (≤3) are reviewed in the window → full tier", async () => {
  const { markTodayWordReviewComplete } = await importCompletion();
  sessionRow = makeRow({
    targetSavedWordIds: ["w1", "w2"],
    reviewTargetCount: 2,
    readingCompletedAt: new Date("2026-06-27T07:00:00Z"),
    comprehensionCompletedAt: new Date("2026-06-27T07:30:00Z"),
    completionTier: "comprehension",
  });
  savedWords = [
    { id: "w1", userId: "u1", lastReviewedAt: new Date("2026-06-27T08:00:00Z") },
    { id: "w2", userId: "u1", lastReviewedAt: new Date("2026-06-27T08:05:00Z") },
  ];
  const view = await markTodayWordReviewComplete({ userId: "u1", now: NOW });
  assert.ok(view);
  assert.equal((view!.wordReviewCompletedAt as Date).getTime(), NOW.getTime());
  assert.equal(view!.completionTier, "full");
  assert.equal(view!.status, "completed");
});

test("word-review: not complete until enough targets are reviewed", async () => {
  const { markTodayWordReviewComplete } = await importCompletion();
  sessionRow = makeRow({
    targetSavedWordIds: ["w1", "w2"],
    reviewTargetCount: 2,
    readingCompletedAt: new Date("2026-06-27T07:00:00Z"),
    comprehensionCompletedAt: new Date("2026-06-27T07:30:00Z"),
    completionTier: "comprehension",
  });
  savedWords = [
    { id: "w1", userId: "u1", lastReviewedAt: new Date("2026-06-27T08:00:00Z") },
    { id: "w2", userId: "u1", lastReviewedAt: null }, // not yet reviewed
  ];
  const view = await markTodayWordReviewComplete({ userId: "u1", now: NOW });
  assert.ok(view);
  assert.equal(view!.wordReviewCompletedAt, null);
  assert.equal(view!.completionTier, "comprehension");
  assert.equal(view!.status, "active", "targets exist but review incomplete → not yet complete");
});

test("word-review: reviews BEFORE the session window do not count", async () => {
  const { markTodayWordReviewComplete } = await importCompletion();
  sessionRow = makeRow({
    targetSavedWordIds: ["w1"],
    reviewTargetCount: 1,
    readingCompletedAt: new Date("2026-06-27T07:00:00Z"),
    comprehensionCompletedAt: new Date("2026-06-27T07:30:00Z"),
    completionTier: "comprehension",
  });
  savedWords = [
    // Reviewed yesterday, before the session's createdAt window.
    { id: "w1", userId: "u1", lastReviewedAt: new Date("2026-06-26T10:00:00Z") },
  ];
  const view = await markTodayWordReviewComplete({ userId: "u1", now: NOW });
  assert.ok(view);
  assert.equal(view!.wordReviewCompletedAt, null);
  assert.equal(view!.completionTier, "comprehension");
});

test("word-review: deleted targets drop out gracefully (best-available completes)", async () => {
  const { markTodayWordReviewComplete } = await importCompletion();
  sessionRow = makeRow({
    targetSavedWordIds: ["w1", "w2", "w3"],
    reviewTargetCount: 3,
    readingCompletedAt: new Date("2026-06-27T07:00:00Z"),
    comprehensionCompletedAt: new Date("2026-06-27T07:30:00Z"),
    completionTier: "comprehension",
  });
  // All three target words were deleted since selection → none resolve.
  savedWords = [];
  const view = await markTodayWordReviewComplete({ userId: "u1", now: NOW });
  assert.ok(view, "must not crash when targets are deleted");
  assert.equal(view!.wordReviewCompletedAt, null);
  // No resolvable targets → comprehension is best available → completed.
  assert.equal(view!.completionTier, "comprehension");
  assert.equal(view!.status, "completed");
});

test("word-review: large set requires at least 5 reviewed targets", async () => {
  const { markTodayWordReviewComplete } = await importCompletion();
  const ids = ["w1", "w2", "w3", "w4", "w5", "w6"];
  sessionRow = makeRow({
    targetSavedWordIds: ids,
    reviewTargetCount: ids.length,
    readingCompletedAt: new Date("2026-06-27T07:00:00Z"),
    comprehensionCompletedAt: new Date("2026-06-27T07:30:00Z"),
    completionTier: "comprehension",
  });
  const reviewed = new Date("2026-06-27T08:00:00Z");
  // Only 4 reviewed → below the large-set threshold of 5.
  savedWords = ids.map((id, idx) => ({
    id,
    userId: "u1",
    lastReviewedAt: idx < 4 ? reviewed : null,
  }));
  let view = await markTodayWordReviewComplete({ userId: "u1", now: NOW });
  assert.equal(view!.wordReviewCompletedAt, null, "4/6 is not enough");

  // Now 5 reviewed → meets threshold.
  savedWords = ids.map((id, idx) => ({
    id,
    userId: "u1",
    lastReviewedAt: idx < 5 ? reviewed : null,
  }));
  view = await markTodayWordReviewComplete({ userId: "u1", now: NOW });
  assert.ok(view!.wordReviewCompletedAt, "5/6 meets the large-set threshold");
  assert.equal(view!.completionTier, "full");
});

test("word-review: non-target reviewed words do not complete Today review", async () => {
  const { markTodayWordReviewComplete } = await importCompletion();
  sessionRow = makeRow({
    targetSavedWordIds: ["w1"],
    reviewTargetCount: 1,
    readingCompletedAt: new Date("2026-06-27T07:00:00Z"),
    comprehensionCompletedAt: new Date("2026-06-27T07:30:00Z"),
    completionTier: "comprehension",
  });
  // The target w1 is unreviewed; a non-target word w99 was reviewed — must not count.
  savedWords = [
    { id: "w1", userId: "u1", lastReviewedAt: null },
    { id: "w99", userId: "u1", lastReviewedAt: new Date("2026-06-27T08:00:00Z") },
  ];
  const view = await markTodayWordReviewComplete({ userId: "u1", now: NOW });
  assert.equal(view!.wordReviewCompletedAt, null);
});

// ===========================================================================
// Privacy
// ===========================================================================

test("privacy: completion writes carry ids/timestamps/flags only — no content", async () => {
  const {
    markTodayReadingComplete,
    markTodayComprehensionComplete,
    markTodayWordReviewComplete,
  } = await importCompletion();
  sessionRow = makeRow({
    targetSavedWordIds: ["w1"],
    reviewTargetCount: 1,
  });
  savedWords = [{ id: "w1", userId: "u1", lastReviewedAt: NOW }];

  await markTodayReadingComplete({ userId: "u1", articleId: "a1", now: NOW });
  await markTodayComprehensionComplete({ userId: "u1", articleId: "a1", now: NOW });
  await markTodayWordReviewComplete({ userId: "u1", now: NOW });

  const allowed = new Set([
    "readingCompletedAt",
    "comprehensionCompletedAt",
    "wordReviewCompletedAt",
    "completedAt",
    "completionTier",
    "status",
  ]);
  const allowedTiers = new Set(["none", "reading", "comprehension", "full"]);
  const allowedStatuses = new Set(["active", "completed", "skipped"]);
  assert.ok(updateData.length > 0, "expected at least one completion write");
  for (const d of updateData) {
    for (const [key, value] of Object.entries(d)) {
      assert.ok(allowed.has(key), `unexpected write key: ${key}`);
      // Every persisted value is a Date, null, or a controlled string —
      // never free-text learning content.
      const ok =
        value === null ||
        value instanceof Date ||
        (key === "completionTier" && allowedTiers.has(value as string)) ||
        (key === "status" && allowedStatuses.has(value as string));
      assert.ok(ok, `write value for ${key} is not an id/timestamp/flag: ${JSON.stringify(value)}`);
    }
  }
});
