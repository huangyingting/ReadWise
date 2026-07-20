/**
 * Pure annotation re-anchoring tests (#1103).
 *
 * Exercises the net-new AMBIGUITY DETECTION + collision resolution layered on
 * top of the existing `revalidateAnchor` engine, with NO database/network/clock.
 * Deterministic fixtures cover every migration shape the issue calls out:
 * insertions, deletions, moved paragraphs, repeated text, a failed match, and
 * mixed success — proving AC1 (exact + context-assisted migrate to the SAME
 * semantic passage) and AC2 (ambiguous/missing anchors are never silently
 * dropped or moved arbitrarily).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessAnchor,
  assessAnchors,
  buildReanchorPlan,
  type ReanchorAnchorInput,
} from "@/lib/scraper/incremental/annotation-reanchor";

// ---------------------------------------------------------------------------
// Fixture helpers — build a W3C-style anchor (quote + offsets + ±24 context)
// from a source text, exactly as the reader stores it.
// ---------------------------------------------------------------------------

function nthIndexOf(haystack: string, needle: string, occurrence: number): number {
  let idx = -1;
  for (let i = 0; i < occurrence; i += 1) {
    idx = haystack.indexOf(needle, idx + 1);
    if (idx === -1) return -1;
  }
  return idx;
}

function anchorFromText(
  id: string,
  sourceText: string,
  quote: string,
  options: { userId?: string; occurrence?: number } = {},
): ReanchorAnchorInput {
  const { userId = "u1", occurrence = 1 } = options;
  const startOffset = nthIndexOf(sourceText, quote, occurrence);
  if (startOffset < 0) throw new Error(`quote not found in source: ${quote}`);
  const endOffset = startOffset + quote.length;
  return {
    id,
    userId,
    quote,
    startOffset,
    endOffset,
    prefix: sourceText.slice(Math.max(0, startOffset - 24), startOffset),
    suffix: sourceText.slice(endOffset, endOffset + 24),
  };
}

// ---------------------------------------------------------------------------
// AC1 — exact anchors
// ---------------------------------------------------------------------------

test("exact: an unchanged quote stays at its offsets with no move", () => {
  const text = "The quick brown fox jumped over the lazy dog by the river.";
  const anchor = anchorFromText("h1", text, "brown fox jumped");
  const a = assessAnchor(anchor, text);
  assert.equal(a.reliability, "exact");
  assert.equal(a.reliable, true);
  assert.equal(a.moved, false);
  assert.equal(a.targetStartOffset, anchor.startOffset);
  assert.equal(a.targetEndOffset, anchor.endOffset);
});

// ---------------------------------------------------------------------------
// AC1 — context-assisted / positional moves (insertion, deletion, moved para)
// ---------------------------------------------------------------------------

test("insertion: text inserted before a unique quote re-anchors to the new offset", () => {
  const oldText = "Chapter one. The heron waded into the shallow pool at dawn.";
  const anchor = anchorFromText("h1", oldText, "heron waded into the shallow pool");
  const newText = "A brand new opening sentence was added. " + oldText;

  const a = assessAnchor(anchor, newText);
  assert.equal(a.reliability, "moved");
  assert.equal(a.reliable, true);
  assert.equal(a.moved, true);
  const expected = newText.indexOf("heron waded into the shallow pool");
  assert.equal(a.targetStartOffset, expected);
  assert.equal(a.targetEndOffset, expected + anchor.quote.length);
  // Same semantic passage: the migrated slice still reads the same text.
  assert.equal(newText.slice(a.targetStartOffset, a.targetEndOffset), anchor.quote);
});

test("deletion: text removed before a unique quote re-anchors to the earlier offset", () => {
  const oldText = "An overlong preamble we will delete. The comet blazed across the northern sky.";
  const anchor = anchorFromText("h1", oldText, "comet blazed across the northern sky");
  const newText = "The comet blazed across the northern sky.";

  const a = assessAnchor(anchor, newText);
  assert.equal(a.reliability, "moved");
  assert.equal(a.reliable, true);
  assert.equal(a.moved, true);
  assert.equal(newText.slice(a.targetStartOffset, a.targetEndOffset), anchor.quote);
});

test("moved paragraph: a relocated unique quote re-anchors to its new position", () => {
  const intro = "Introduction paragraph that stays put. ";
  const para = "The lighthouse keeper logged every passing ship after midnight.";
  const oldText = intro + para + " Closing remarks.";
  const anchor = anchorFromText("h1", oldText, "lighthouse keeper logged every passing ship");
  // Paragraph moved to the END of the document.
  const newText = intro + "Closing remarks. " + para;

  const a = assessAnchor(anchor, newText);
  assert.equal(a.reliability, "moved");
  assert.equal(a.reliable, true);
  assert.equal(newText.slice(a.targetStartOffset, a.targetEndOffset), anchor.quote);
});

test("context-assisted: a repeated quote resolves to the SAME occurrence its context pins", () => {
  const oldText =
    "Prologue. The bell rang loudly. The crowd cheered. The bell rang loudly. Epilogue.";
  // Anchor the SECOND occurrence (its prefix carries 'The crowd cheered. ').
  const anchor = anchorFromText("h1", oldText, "The bell rang loudly.", { occurrence: 2 });
  // Insert content at the very start so offsets shift but both occurrences remain.
  const newText = "A newly inserted lead paragraph. " + oldText;

  const a = assessAnchor(anchor, newText);
  assert.equal(a.reliability, "moved");
  assert.equal(a.reliable, true);
  // MUST land on the SECOND occurrence (the one the context resolves), not the first.
  const secondOccurrence = nthIndexOf(newText, "The bell rang loudly.", 2);
  assert.equal(a.targetStartOffset, secondOccurrence);
});

test("whitespace reflow: a uniquely reflowed quote re-anchors via the tolerant match", () => {
  const anchor = anchorFromText(
    "h1",
    "Header. the quick brown fox leaps.",
    "the quick brown fox",
  );
  // Same words, but reflowed with extra spaces / a newline (no exact substring).
  const newText = "A different intro entirely. the quick   brown\nfox leaps onward.";

  const a = assessAnchor(anchor, newText);
  assert.equal(a.reliability, "moved");
  assert.equal(a.reliable, true);
});

// ---------------------------------------------------------------------------
// AC2 — repeated/ambiguous + missing anchors are UNRELIABLE (never dropped/moved)
// ---------------------------------------------------------------------------

test("repeated text (no disambiguating context): a moved quote is AMBIGUOUS, not moved", () => {
  const newText = "The cat sat. The cat sat.";
  // Anchor whose stored offsets no longer slice to the quote and whose empty
  // context cannot disambiguate the two identical occurrences.
  const anchor: ReanchorAnchorInput = {
    id: "h1",
    userId: "u1",
    quote: "The cat sat.",
    startOffset: 100,
    endOffset: 112,
    prefix: "",
    suffix: "",
  };
  const a = assessAnchor(anchor, newText);
  assert.equal(a.reliability, "ambiguous");
  assert.equal(a.reliable, false);
  assert.equal(a.moved, false);
});

test("repeated text (identical context on both): still AMBIGUOUS", () => {
  const newText = "X The cat sat. Y X The cat sat. Y";
  const anchor: ReanchorAnchorInput = {
    id: "h1",
    userId: "u1",
    quote: "The cat sat.",
    startOffset: 200,
    endOffset: 212,
    prefix: "X ",
    suffix: " Y",
  };
  const a = assessAnchor(anchor, newText);
  assert.equal(a.reliability, "ambiguous");
  assert.equal(a.reliable, false);
});

test("failed match: a quote that no longer exists is MISSING (not moved)", () => {
  const anchor = anchorFromText(
    "h1",
    "The elephant parade marched through the town square.",
    "elephant parade marched",
  );
  const newText = "The council meeting was postponed until next Thursday afternoon.";
  const a = assessAnchor(anchor, newText);
  assert.equal(a.reliability, "missing");
  assert.equal(a.reliable, false);
  assert.equal(a.moved, false);
});

// ---------------------------------------------------------------------------
// Collision handling — never violate @@unique(userId, articleId, offsets)
// ---------------------------------------------------------------------------

test("collision: a moved anchor that would land on an exact anchor's offsets is demoted", () => {
  const newText = "one two alpha one two beta";
  // A: exact at the SECOND 'one two' [14,21].
  const exact = anchorFromText("exact", newText, "one two", { occurrence: 2 });
  // B: a moved anchor whose context ('alpha ...beta') resolves to the SAME [14,21].
  const moved: ReanchorAnchorInput = {
    id: "moved",
    userId: "u1",
    quote: "one two",
    startOffset: 500,
    endOffset: 507,
    prefix: "alpha ",
    suffix: " beta",
  };

  const [aExact, aMoved] = assessAnchors([exact, moved], newText);
  assert.equal(aExact.reliability, "exact");
  assert.equal(aExact.reliable, true);
  // The moved anchor is demoted rather than colliding on the unique offset slot.
  assert.equal(aMoved.reliability, "ambiguous");
  assert.equal(aMoved.reliable, false);
  assert.equal(aMoved.moved, false);
});

test("collision: different users landing on identical offsets do NOT collide", () => {
  const newText = "one two alpha one two beta";
  const exact = anchorFromText("exact", newText, "one two", { occurrence: 2, userId: "u1" });
  const moved: ReanchorAnchorInput = {
    id: "moved",
    userId: "u2",
    quote: "one two",
    startOffset: 500,
    endOffset: 507,
    prefix: "alpha ",
    suffix: " beta",
  };
  const [aExact, aMoved] = assessAnchors([exact, moved], newText);
  assert.equal(aExact.reliable, true);
  // Different owner → different @@unique scope → the move stands.
  assert.equal(aMoved.reliability, "moved");
  assert.equal(aMoved.reliable, true);
});

// ---------------------------------------------------------------------------
// Mixed success — the aggregate plan
// ---------------------------------------------------------------------------

test("mixed success: the plan reports reliable moves and preserves unreliable ids", () => {
  const oldText =
    "Alpha section. The otter dove for clams. Beta section. Repeated phrase here. " +
    "Gamma section. Repeated phrase here. Delta closing.";
  const newText =
    "Newly added lead. Alpha section. The otter dove for clams. Beta section. " +
    "Repeated phrase here. Gamma section. Repeated phrase here. Delta closing.";

  const reliableMove = anchorFromText("reliable", oldText, "otter dove for clams");
  const ambiguous: ReanchorAnchorInput = {
    id: "ambiguous",
    userId: "u1",
    quote: "Repeated phrase here.",
    startOffset: 9000,
    endOffset: 9021,
    prefix: "",
    suffix: "",
  };
  const missing = anchorFromText("missing", oldText, "Delta closing", { occurrence: 1 });
  const missingBroken: ReanchorAnchorInput = {
    ...missing,
    id: "missing",
    quote: "content that was entirely removed",
  };

  const plan = buildReanchorPlan([reliableMove, ambiguous, missingBroken], newText);
  assert.equal(plan.total, 3);
  assert.equal(plan.reliableCount, 1);
  assert.equal(plan.unreliableCount, 2);
  assert.equal(plan.allReliable, false);
  assert.deepEqual(plan.unresolvedAnchorIds.sort(), ["ambiguous", "missing"]);
  // Exactly one move, and it carries IDs + offsets only (no quote/note text).
  assert.equal(plan.moves.length, 1);
  assert.deepEqual(Object.keys(plan.moves[0]).sort(), ["endOffset", "id", "startOffset", "userId"]);
  assert.equal(plan.moves[0].id, "reliable");
  assert.equal(newText.slice(plan.moves[0].startOffset, plan.moves[0].endOffset), "otter dove for clams");
});

test("all reliable: the plan opens the gate when every anchor migrates cleanly", () => {
  const oldText = "The first fact is here. The second fact follows. The third fact ends.";
  const newText = "Preamble added. " + oldText;
  const anchors = [
    anchorFromText("a", oldText, "first fact"),
    anchorFromText("b", oldText, "second fact"),
    anchorFromText("c", oldText, "third fact"),
  ];
  const plan = buildReanchorPlan(anchors, newText);
  assert.equal(plan.allReliable, true);
  assert.equal(plan.reliableCount, 3);
  assert.equal(plan.unreliableCount, 0);
  assert.deepEqual(plan.unresolvedAnchorIds, []);
  assert.equal(plan.moves.length, 3);
});

test("empty: no anchors is trivially all-reliable with nothing to migrate", () => {
  const plan = buildReanchorPlan([], "any content");
  assert.deepEqual(plan, {
    total: 0,
    reliableCount: 0,
    unreliableCount: 0,
    unresolvedAnchorIds: [],
    moves: [],
    allReliable: true,
  });
});
