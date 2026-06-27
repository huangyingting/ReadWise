/**
 * Review assets — highlight/note → review card, content-free counts, and the
 * note-domain reflection store (#812, Today v1.1).
 *
 * Covers:
 *   - converting a highlight into a spaced-repetition review card by REUSING the
 *     existing flashcard/SRS `SavedWord` store (creation, idempotency, IDOR);
 *   - aggregate review-asset counts being strictly content-free (numbers only);
 *   - the optional reflection bonus storing its sentence in the EXISTING note
 *     domain (a highlight's `note`) and nowhere else;
 *   - a privacy assertion: no raw selected text (quote) or note text is ever
 *     returned in the conversion/summary payloads or written outside the
 *     user-owned highlight/flashcard domains.
 */
process.env.LOG_LEVEL = "error";

import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

type Row = Record<string, unknown>;

let highlights: Row[] = [];
let savedWords: Row[] = [];
/** Names of prisma delegates that were written to (create/update). */
let writes: string[] = [];

const NOW = new Date("2026-06-27T12:00:00Z");

function makeHighlight(overrides: Row = {}): Row {
  return {
    id: "h1",
    userId: "u1",
    articleId: "a1",
    quote: "The mitochondria is the powerhouse of the cell.",
    startOffset: 10,
    endOffset: 57,
    prefix: "",
    suffix: "",
    note: null,
    color: null,
    createdAt: new Date("2026-06-26T00:00:00Z"),
    updatedAt: new Date("2026-06-26T00:00:00Z"),
    ...overrides,
  };
}

before(() => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        highlight: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
            const row = highlights.find(
              (h) => h.id === where.id && h.userId === where.userId,
            );
            return row ? { ...row } : null;
          },
          update: async ({
            where,
            data,
          }: {
            where: { id: string };
            data: Row;
          }) => {
            const row = highlights.find((h) => h.id === where.id);
            if (!row) throw new Error("not found");
            Object.assign(row, data, { updatedAt: NOW });
            writes.push("highlight.update");
            return { ...row };
          },
          count: async ({ where }: { where: Row }) => {
            return highlights.filter((h) => matchesHighlight(h, where)).length;
          },
          groupBy: async ({ where }: { where: { userId: string } }) => {
            const ids = new Set(
              highlights
                .filter((h) => h.userId === where.userId)
                .map((h) => h.articleId),
            );
            return [...ids].map((articleId) => ({
              articleId,
              _count: { id: 1 },
            }));
          },
        },
        savedWord: {
          findUnique: async ({
            where,
          }: {
            where: { userId_word: { userId: string; word: string } };
          }) => {
            const k = where.userId_word;
            const row = savedWords.find(
              (s) => s.userId === k.userId && s.word === k.word,
            );
            return row ? { id: row.id, dueAt: row.dueAt } : null;
          },
          create: async ({ data }: { data: Row }) => {
            const row = { id: `sw${savedWords.length + 1}`, dueAt: null, ...data };
            savedWords.push(row);
            writes.push("savedWord.create");
            return { id: row.id, dueAt: row.dueAt };
          },
        },
      },
    },
  });
});

/** Mimic the prisma `where` filter used by getReviewAssetSummary. */
function matchesHighlight(h: Row, where: Row): boolean {
  if (where.userId && h.userId !== where.userId) return false;
  if (where.note && typeof where.note === "object") {
    // { not: null } — only highlights that carry a note.
    if (h.note == null) return false;
  }
  if (where.createdAt && typeof where.createdAt === "object") {
    const gte = (where.createdAt as { gte: Date }).gte;
    if ((h.createdAt as Date).getTime() < gte.getTime()) return false;
  }
  return true;
}

beforeEach(() => {
  highlights = [];
  savedWords = [];
  writes = [];
});

const importAssets = () => import("@/lib/learning/review-assets");

// ===========================================================================
// Highlight/note → review card (reuses SavedWord/SRS)
// ===========================================================================

test("convertHighlightToReviewCard creates an SRS card from a highlight", async () => {
  const { convertHighlightToReviewCard } = await importAssets();
  highlights.push(makeHighlight({ note: "powerhouse = main energy source" }));

  const result = await convertHighlightToReviewCard("u1", "h1");
  assert.ok(result);
  assert.equal(result!.created, true);
  // A brand-new card is immediately due (null dueAt) — reuses the flashcard loop.
  assert.equal(result!.dueAt, null);

  // The content lives in the reused SavedWord (flashcard) store — the note/
  // highlight/flashcard domain where the learner already keeps such text.
  assert.equal(savedWords.length, 1);
  assert.equal(savedWords[0].explanation, "powerhouse = main energy source");
  assert.equal(
    savedWords[0].contextSentence,
    "The mitochondria is the powerhouse of the cell.",
  );
  assert.equal(savedWords[0].articleId, "a1");
});

test("convertHighlightToReviewCard is idempotent (no duplicate, no schedule reset)", async () => {
  const { convertHighlightToReviewCard, reviewCardFront } = await importAssets();
  const quote = makeHighlight().quote as string;
  highlights.push(makeHighlight());
  // Simulate an already-converted, partially-reviewed card.
  savedWords.push({
    id: "sw-existing",
    userId: "u1",
    word: reviewCardFront(quote),
    dueAt: new Date("2026-07-01T00:00:00Z"),
  });

  const result = await convertHighlightToReviewCard("u1", "h1");
  assert.ok(result);
  assert.equal(result!.created, false);
  assert.equal(result!.cardId, "sw-existing");
  // The existing SRS schedule is preserved (no second card, no reset).
  assert.equal(savedWords.length, 1);
  assert.deepEqual(result!.dueAt, new Date("2026-07-01T00:00:00Z"));
});

test("convertHighlightToReviewCard is scoped to the owner (IDOR-safe)", async () => {
  const { convertHighlightToReviewCard } = await importAssets();
  highlights.push(makeHighlight({ userId: "owner" }));

  // A different user cannot convert someone else's highlight.
  const result = await convertHighlightToReviewCard("attacker", "h1");
  assert.equal(result, null);
  assert.equal(savedWords.length, 0);
});

test("convertHighlightToReviewCard returns null for a missing highlight", async () => {
  const { convertHighlightToReviewCard } = await importAssets();
  const result = await convertHighlightToReviewCard("u1", "nope");
  assert.equal(result, null);
});

// ===========================================================================
// Aggregate, content-free counts
// ===========================================================================

test("getReviewAssetSummary returns content-free aggregate counts only", async () => {
  const { getReviewAssetSummary } = await importAssets();
  highlights.push(
    makeHighlight({ id: "h1", articleId: "a1", note: "n", createdAt: NOW }),
    makeHighlight({ id: "h2", articleId: "a1", note: null, createdAt: NOW }),
    makeHighlight({
      id: "h3",
      articleId: "a2",
      note: "n2",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }),
    makeHighlight({ id: "other", userId: "u2", articleId: "a9", note: "x" }),
  );

  const summary = await getReviewAssetSummary("u1", NOW);
  assert.deepEqual(summary, {
    totalHighlights: 3,
    notedHighlights: 2,
    weeklyHighlights: 2,
    articlesWithHighlights: 2,
  });

  // Privacy: every value is a number — no quote/note text leaks into the summary.
  for (const value of Object.values(summary)) {
    assert.equal(typeof value, "number");
  }
});

// ===========================================================================
// Optional Today reflection bonus — stored in the existing note domain
// ===========================================================================

test("recordTodayReflection stores the sentence in the highlight note domain", async () => {
  const { recordTodayReflection } = await importAssets();
  highlights.push(makeHighlight({ note: null }));

  const result = await recordTodayReflection({
    userId: "u1",
    highlightId: "h1",
    sentence: "  Cells make their own energy.  ",
  });
  assert.deepEqual(result, { ok: true, highlightId: "h1" });

  // The reflection landed in the EXISTING note domain (Highlight.note), trimmed.
  assert.equal(highlights[0].note, "Cells make their own energy.");
  // It only ever wrote to the highlight (note) domain — never a SavedWord or
  // any TodaySession/analytics surface.
  assert.deepEqual(writes, ["highlight.update"]);
  assert.equal(savedWords.length, 0);
});

test("recordTodayReflection rejects an empty sentence (400)", async () => {
  const { recordTodayReflection } = await importAssets();
  highlights.push(makeHighlight());

  const result = await recordTodayReflection({
    userId: "u1",
    highlightId: "h1",
    sentence: "   ",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
  assert.deepEqual(writes, []);
});

test("recordTodayReflection is IDOR-safe (404 for another user's highlight)", async () => {
  const { recordTodayReflection } = await importAssets();
  highlights.push(makeHighlight({ userId: "owner" }));

  const result = await recordTodayReflection({
    userId: "attacker",
    highlightId: "h1",
    sentence: "trying to write someone else's note",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 404);
  assert.deepEqual(writes, []);
});

// ===========================================================================
// Privacy: the conversion payload carries ids/schedule only — no raw text
// ===========================================================================

test("conversion payload exposes ids/schedule only — never raw selected text", async () => {
  const { convertHighlightToReviewCard } = await importAssets();
  highlights.push(makeHighlight({ note: "secret note text" }));

  const result = await convertHighlightToReviewCard("u1", "h1");
  assert.ok(result);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("powerhouse"));
  assert.ok(!serialized.includes("secret note text"));
  assert.deepEqual(Object.keys(result!).sort(), ["cardId", "created", "dueAt"]);
});
