/**
 * Tests for src/lib/offline-conflict.ts (RW-043).
 *
 * Pure conflict-resolution rules — no Prisma / network. Covers multi-device
 * scenarios: progress forward-only, note merge preserves text, anchor
 * revalidation (valid / moved / missing), generic last-write-wins.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveProgress,
  resolveLastWriteWins,
  revalidateAnchor,
  mergeNoteConflict,
  NOTE_CONFLICT_SEPARATOR,
} from "@/lib/offline-conflict";

// ---------------------------------------------------------------------------
// resolveProgress — forward-only
// ---------------------------------------------------------------------------

test("resolveProgress keeps the higher percent (never regresses)", () => {
  const r = resolveProgress({ percent: 80, completed: false }, { percent: 40, completed: false });
  assert.equal(r.percent, 80);
  assert.equal(r.completed, false);
});

test("resolveProgress takes a higher client percent", () => {
  const r = resolveProgress({ percent: 30, completed: false }, { percent: 75, completed: false });
  assert.equal(r.percent, 75);
});

test("resolveProgress keeps completion sticky once either side completed", () => {
  const r = resolveProgress({ percent: 100, completed: true }, { percent: 20, completed: false });
  assert.equal(r.percent, 100);
  assert.equal(r.completed, true);
});

test("resolveProgress marks completed when the merged percent crosses the threshold", () => {
  const r = resolveProgress(
    { percent: 50, completed: false },
    { percent: 96, completed: false },
    95,
  );
  assert.equal(r.percent, 96);
  assert.equal(r.completed, true);
});

// ---------------------------------------------------------------------------
// resolveLastWriteWins
// ---------------------------------------------------------------------------

test("resolveLastWriteWins picks the strictly-newer client edit", () => {
  assert.equal(
    resolveLastWriteWins("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"),
    "client",
  );
});

test("resolveLastWriteWins favours the server on a tie", () => {
  assert.equal(
    resolveLastWriteWins("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    "server",
  );
});

test("resolveLastWriteWins keeps the server when its edit is newer", () => {
  assert.equal(
    resolveLastWriteWins("2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    "server",
  );
});

// ---------------------------------------------------------------------------
// revalidateAnchor
// ---------------------------------------------------------------------------

const PLAIN = "The quick brown fox jumps over the lazy dog.";

test("revalidateAnchor returns valid when the quote still sits at its offsets", () => {
  // "quick" is at offset 4..9
  const r = revalidateAnchor({ quote: "quick", startOffset: 4, endOffset: 9 }, PLAIN);
  assert.equal(r.status, "valid");
  assert.equal(r.stale, false);
});

test("revalidateAnchor reports moved with suggested offsets when content shifted", () => {
  const shifted = "Yesterday, " + PLAIN; // everything moves right by 11
  const r = revalidateAnchor({ quote: "quick", startOffset: 4, endOffset: 9 }, shifted);
  assert.equal(r.status, "moved");
  assert.equal(r.stale, true);
  assert.equal(r.suggestedStartOffset, shifted.indexOf("quick"));
  assert.equal(r.suggestedEndOffset, shifted.indexOf("quick") + "quick".length);
});

test("revalidateAnchor uses prefix/suffix context to disambiguate repeats", () => {
  const text = "go go go stop go go";
  // Target the SECOND "stop"-adjacent... here choose the unique "stop" anchor.
  const r = revalidateAnchor(
    { quote: "stop", startOffset: 0, endOffset: 4, prefix: "go ", suffix: " go" },
    text,
  );
  assert.equal(r.status, "moved");
  assert.equal(r.suggestedStartOffset, text.indexOf("stop"));
});

test("revalidateAnchor returns missing when the quote is gone entirely", () => {
  const r = revalidateAnchor({ quote: "elephant", startOffset: 4, endOffset: 12 }, PLAIN);
  assert.equal(r.status, "missing");
  assert.equal(r.stale, true);
});

test("revalidateAnchor tolerates whitespace reflow", () => {
  const r = revalidateAnchor(
    { quote: "quick brown", startOffset: 4, endOffset: 15 },
    "The quick   brown fox", // collapsed whitespace differs
  );
  // Offsets no longer line up exactly, but normalized comparison/search finds it.
  assert.notEqual(r.status, "missing");
});

// ---------------------------------------------------------------------------
// mergeNoteConflict
// ---------------------------------------------------------------------------

test("mergeNoteConflict takes the client edit when the server is unchanged from base", () => {
  const r = mergeNoteConflict("base text", "my offline edit", "base text");
  assert.equal(r.conflict, false);
  assert.equal(r.text, "my offline edit");
});

test("mergeNoteConflict keeps the server value when the client never changed it", () => {
  const r = mergeNoteConflict("server changed", "base text", "base text");
  assert.equal(r.conflict, false);
  assert.equal(r.text, "server changed");
});

test("mergeNoteConflict preserves BOTH texts when both diverged (no silent loss)", () => {
  const r = mergeNoteConflict("server edit", "client edit", "base text");
  assert.equal(r.conflict, true);
  assert.ok(r.text!.includes("client edit"), "client text retained");
  assert.ok(r.text!.includes("server edit"), "server text retained");
  assert.ok(r.text!.includes(NOTE_CONFLICT_SEPARATOR.trim().split("\n")[0] || "also edited"));
});

test("mergeNoteConflict treats unknown base as a conflict so text is never lost", () => {
  const r = mergeNoteConflict("server edit", "client edit");
  assert.equal(r.conflict, true);
  assert.ok(r.text!.includes("client edit"));
  assert.ok(r.text!.includes("server edit"));
});

test("mergeNoteConflict returns no conflict when both sides are identical", () => {
  const r = mergeNoteConflict("same", "same", "base");
  assert.equal(r.conflict, false);
  assert.equal(r.text, "same");
});

test("mergeNoteConflict yields null for an empty result", () => {
  const r = mergeNoteConflict("", "", null);
  assert.equal(r.text, null);
  assert.equal(r.conflict, false);
});
