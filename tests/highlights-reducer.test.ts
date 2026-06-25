/**
 * Tests for src/components/reader/highlightsReducer.ts (REF-030).
 *
 * Pure reducer — no React, no browser, no DB.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  highlightsReducer,
  type HighlightAction,
} from "@/components/reader/highlightsReducer";
import type { Highlight } from "@/components/ReaderHighlightsProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: "h-1",
    quote: "hello world",
    startOffset: 0,
    endOffset: 11,
    prefix: "",
    suffix: "",
    note: null,
    color: "yellow",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SET
// ---------------------------------------------------------------------------

describe("SET", () => {
  test("replaces state with the provided highlights array", () => {
    const initial: Highlight[] = [makeHighlight({ id: "old" })];
    const incoming = [makeHighlight({ id: "new-1" }), makeHighlight({ id: "new-2" })];
    const next = highlightsReducer(initial, { type: "SET", highlights: incoming });
    assert.deepEqual(next, incoming);
  });

  test("replaces with an empty array", () => {
    const initial = [makeHighlight()];
    const next = highlightsReducer(initial, { type: "SET", highlights: [] });
    assert.deepEqual(next, []);
  });
});

// ---------------------------------------------------------------------------
// ADD_OPTIMISTIC
// ---------------------------------------------------------------------------

describe("ADD_OPTIMISTIC", () => {
  test("appends an optimistic highlight and sorts by startOffset", () => {
    const existing = makeHighlight({ id: "h-1", startOffset: 10, endOffset: 20 });
    const optimistic = makeHighlight({
      id: "optimistic-1",
      startOffset: 0,
      endOffset: 9,
    });
    const next = highlightsReducer([existing], {
      type: "ADD_OPTIMISTIC",
      optimistic,
    });
    assert.equal(next.length, 2);
    assert.equal(next[0].id, "optimistic-1");
    assert.equal(next[1].id, "h-1");
  });
});

// ---------------------------------------------------------------------------
// REPLACE_OPTIMISTIC
// ---------------------------------------------------------------------------

describe("REPLACE_OPTIMISTIC", () => {
  test("swaps the optimistic entry for the real one and re-sorts", () => {
    const opt = makeHighlight({ id: "optimistic-1", startOffset: 5, endOffset: 10 });
    const existing = makeHighlight({ id: "h-1", startOffset: 0, endOffset: 4 });
    const real = makeHighlight({ id: "h-2", startOffset: 5, endOffset: 10 });

    const next = highlightsReducer([existing, opt], {
      type: "REPLACE_OPTIMISTIC",
      tempId: "optimistic-1",
      real,
    });

    assert.equal(next.length, 2);
    assert.ok(!next.find((h) => h.id === "optimistic-1"));
    assert.ok(next.find((h) => h.id === "h-2"));
    // Sort preserved
    assert.equal(next[0].id, "h-1");
    assert.equal(next[1].id, "h-2");
  });
});

// ---------------------------------------------------------------------------
// REVERT_OPTIMISTIC
// ---------------------------------------------------------------------------

describe("REVERT_OPTIMISTIC", () => {
  test("removes the optimistic entry", () => {
    const opt = makeHighlight({ id: "optimistic-1" });
    const real = makeHighlight({ id: "h-1" });
    const next = highlightsReducer([real, opt], {
      type: "REVERT_OPTIMISTIC",
      tempId: "optimistic-1",
    });
    assert.equal(next.length, 1);
    assert.equal(next[0].id, "h-1");
  });

  test("is a no-op for an unknown id", () => {
    const initial = [makeHighlight()];
    const next = highlightsReducer(initial, {
      type: "REVERT_OPTIMISTIC",
      tempId: "nonexistent",
    });
    assert.equal(next.length, 1);
  });
});

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

describe("UPDATE", () => {
  test("applies a partial patch to the matching highlight", () => {
    const initial = [makeHighlight({ id: "h-1", color: "yellow", note: null })];
    const next = highlightsReducer(initial, {
      type: "UPDATE",
      id: "h-1",
      patch: { color: "green" },
    });
    assert.equal(next[0].color, "green");
    assert.equal(next[0].note, null); // unchanged
  });

  test("does not affect other highlights", () => {
    const h1 = makeHighlight({ id: "h-1", color: "yellow" });
    const h2 = makeHighlight({ id: "h-2", color: "blue" });
    const next = highlightsReducer([h1, h2], {
      type: "UPDATE",
      id: "h-1",
      patch: { color: "pink" },
    });
    assert.equal(next[0].color, "pink");
    assert.equal(next[1].color, "blue");
  });

  test("is a no-op for an unknown id", () => {
    const initial = [makeHighlight({ id: "h-1" })];
    const next = highlightsReducer(initial, {
      type: "UPDATE",
      id: "nonexistent",
      patch: { color: "pink" },
    });
    assert.equal(next[0].color, "yellow");
  });
});

// ---------------------------------------------------------------------------
// REMOVE
// ---------------------------------------------------------------------------

describe("REMOVE", () => {
  test("removes the highlight with the given id", () => {
    const h1 = makeHighlight({ id: "h-1" });
    const h2 = makeHighlight({ id: "h-2" });
    const next = highlightsReducer([h1, h2], { type: "REMOVE", id: "h-1" });
    assert.equal(next.length, 1);
    assert.equal(next[0].id, "h-2");
  });

  test("is a no-op for an unknown id", () => {
    const initial = [makeHighlight()];
    const next = highlightsReducer(initial, {
      type: "REMOVE",
      id: "nonexistent",
    });
    assert.equal(next.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Unknown action (type-safe default branch)
// ---------------------------------------------------------------------------

describe("unknown action", () => {
  test("returns state unchanged for an unrecognised action type", () => {
    const initial = [makeHighlight()];
    // Cast to bypass TypeScript exhaustive check
    const next = highlightsReducer(initial, {
      type: "UNKNOWN",
    } as unknown as HighlightAction);
    assert.equal(next, initial);
  });
});
