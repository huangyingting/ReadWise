import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  CreateHighlightInput,
  Highlight,
} from "@/components/ReaderHighlightsProvider";
import { replaceOverlappingHighlights } from "@/components/reader/wordLookup/useHighlightActions";

function highlight(overrides: Partial<Highlight>): Highlight {
  return {
    id: "h-1",
    quote: "text",
    startOffset: 0,
    endOffset: 4,
    prefix: "",
    suffix: "",
    note: null,
    color: "yellow",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("overlap replacement preserves every note and deletes only after create succeeds", async () => {
  const events: string[] = [];
  const inputs: CreateHighlightInput[] = [];
  const replacement = highlight({
    id: "replacement",
    quote: "abcdef",
    startOffset: 0,
    endOffset: 6,
  });

  const result = await replaceOverlappingHighlights({
    savedAnchor: {
      quote: "cd",
      startOffset: 2,
      endOffset: 4,
      prefix: "ab",
      suffix: "ef",
      selectionWord: "cd",
    },
    color: "blue",
    fullText: "abcdef",
    overlapping: [
      highlight({ id: "left", startOffset: 0, endOffset: 3, note: "first note" }),
      highlight({ id: "right", startOffset: 3, endOffset: 6, note: "second note" }),
    ],
    add: async (value) => {
      events.push("add");
      inputs.push(value);
      return replacement;
    },
    remove: async (id) => {
      events.push(`remove:${id}`);
    },
  });

  assert.equal(result, replacement);
  assert.match(inputs[0]?.note ?? "", /first note/);
  assert.match(inputs[0]?.note ?? "", /second note/);
  assert.deepEqual(events, ["add", "remove:left", "remove:right"]);
});

test("failed overlap replacement leaves every original highlight untouched", async () => {
  const removed: string[] = [];
  const result = await replaceOverlappingHighlights({
    savedAnchor: {
      quote: "cd",
      startOffset: 2,
      endOffset: 4,
      prefix: "ab",
      suffix: "ef",
      selectionWord: "cd",
    },
    color: "blue",
    fullText: "abcdef",
    overlapping: [
      highlight({
        id: "existing",
        startOffset: 1,
        endOffset: 3,
        note: "keep me",
      }),
    ],
    add: async () => null,
    remove: async (id) => {
      removed.push(id);
    },
  });

  assert.equal(result, null);
  assert.deepEqual(removed, []);
});

test("overlap replacement rejects an oversized merged note before deleting originals", async () => {
  let addCalls = 0;
  const removed: string[] = [];
  const result = await replaceOverlappingHighlights({
    savedAnchor: {
      quote: "cd",
      startOffset: 2,
      endOffset: 4,
      prefix: "ab",
      suffix: "ef",
      selectionWord: "cd",
    },
    color: "blue",
    fullText: "abcdef",
    overlapping: [
      highlight({ id: "left", startOffset: 0, endOffset: 3, note: "a".repeat(1_100) }),
      highlight({ id: "right", startOffset: 3, endOffset: 6, note: "b".repeat(1_100) }),
    ],
    add: async () => {
      addCalls += 1;
      return highlight({ id: "replacement" });
    },
    remove: async (id) => {
      removed.push(id);
    },
  });

  assert.equal(result, null);
  assert.equal(addCalls, 0);
  assert.deepEqual(removed, []);
});

test("an existing highlight that already spans the merged range is reused", async () => {
  const covering = highlight({
    id: "covering",
    quote: "abcdef",
    startOffset: 0,
    endOffset: 6,
    note: "keep",
  });
  let addCalls = 0;
  const removed: string[] = [];

  const result = await replaceOverlappingHighlights({
    savedAnchor: {
      quote: "cd",
      startOffset: 2,
      endOffset: 4,
      prefix: "ab",
      suffix: "ef",
      selectionWord: "cd",
    },
    color: "green",
    fullText: "abcdef",
    overlapping: [
      covering,
      highlight({ id: "nested", startOffset: 2, endOffset: 4, note: "nested note" }),
    ],
    add: async () => {
      addCalls += 1;
      return null;
    },
    remove: async (id) => {
      removed.push(id);
    },
  });

  assert.equal(result, covering);
  assert.equal(addCalls, 0);
  assert.deepEqual(removed, []);
});
