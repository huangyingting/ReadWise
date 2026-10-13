/**
 * Selection-toolbar highlight actions: plain highlight and highlight-with-note,
 * including the overlap merge and the deferred note-editor hand-off.
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";

import type {
  CreateHighlightInput,
  Highlight,
  RemoveHighlightOptions,
} from "@/components/ReaderHighlightsProvider";

mock.module("react", {
  namedExports: { useCallback: <T>(callback: T) => callback },
});

const ANCHOR = {
  quote: "cd",
  startOffset: 2,
  endOffset: 4,
  prefix: "ab",
  suffix: "ef",
  selectionWord: "cd",
};

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

function harness(addResult: Highlight | null, prose: { textContent: string } | null) {
  const added: CreateHighlightInput[] = [];
  const removed: Array<{ id: string; options?: RemoveHighlightOptions }> = [];
  const add = async (input: CreateHighlightInput) => {
    added.push(input);
    return addResult;
  };
  const remove = async (id: string, options?: RemoveHighlightOptions) => {
    removed.push({ id, options });
  };
  return { added, removed, add, remove, proseRef: { current: prose as unknown as HTMLElement | null } };
}

test("handleHighlight saves the selection as-is when nothing overlaps", async () => {
  const { useHighlightActions } = await import("@/components/reader/wordLookup/useHighlightActions");
  const h = harness(highlight({ id: "new" }), { textContent: "abcdef" });
  const { handleHighlight } = useHighlightActions([], h.add, h.remove, h.proseRef);

  await handleHighlight(ANCHOR, "blue");

  assert.deepEqual(h.added, [
    { quote: "cd", startOffset: 2, endOffset: 4, prefix: "ab", suffix: "ef", color: "blue" },
  ]);
  assert.deepEqual(h.removed, []);
});

test("handleHighlight merges overlaps and orders deletes after an optimistic replacement", async () => {
  const { useHighlightActions } = await import("@/components/reader/wordLookup/useHighlightActions");
  const existing = [highlight({ id: "left", startOffset: 0, endOffset: 3 })];
  const h = harness(highlight({ id: "optimistic-merged", startOffset: 0, endOffset: 4 }), {
    textContent: "abcdef",
  });
  const { handleHighlight } = useHighlightActions(existing, h.add, h.remove, h.proseRef);

  await handleHighlight(ANCHOR, "green");

  assert.equal(h.added[0]?.quote, "abcd");
  assert.deepEqual(h.removed, [{ id: "left", options: { dependsOnHighlightId: "optimistic-merged" } }]);
});

test("both actions do nothing without a mounted prose element", async () => {
  const { useHighlightActions } = await import("@/components/reader/wordLookup/useHighlightActions");
  const h = harness(highlight({ id: "new" }), null);
  const { handleHighlight, handleAddNote } = useHighlightActions([], h.add, h.remove, h.proseRef);

  await handleHighlight(ANCHOR, "blue");
  await handleAddNote(ANCHOR, "blue", () => assert.fail("editor must not open"));

  assert.deepEqual(h.added, []);
});

test("handleAddNote opens the editor on the painted mark after the paint delay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { useHighlightActions } = await import("@/components/reader/wordLookup/useHighlightActions");
  const mark = { tagName: "MARK" } as unknown as HTMLElement;
  const selectors: string[] = [];
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector: (selector: string) => {
      selectors.push(selector);
      return selector.includes('"painted"') ? mark : null;
    },
  } as unknown as Document;
  t.after(() => {
    globalThis.document = previousDocument;
  });

  const opened: Array<[string, HTMLElement]> = [];
  const painted = harness(highlight({ id: "painted" }), { textContent: "abcdef" });
  await useHighlightActions([], painted.add, painted.remove, painted.proseRef)
    .handleAddNote(ANCHOR, "pink", (id, el) => opened.push([id, el]));
  assert.equal(opened.length, 0);
  t.mock.timers.tick(80);
  assert.deepEqual(opened, [["painted", mark]]);
  assert.deepEqual(selectors, ['mark.rw-hl[data-hl-id="painted"]']);

  // A mark that never paints does not open the editor.
  const unpainted = harness(highlight({ id: "unpainted" }), { textContent: "abcdef" });
  await useHighlightActions([], unpainted.add, unpainted.remove, unpainted.proseRef)
    .handleAddNote(ANCHOR, "pink", (id, el) => opened.push([id, el]));
  t.mock.timers.tick(80);
  assert.equal(opened.length, 1);
});

test("handleAddNote merges overlaps and skips the editor when saving fails", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { useHighlightActions } = await import("@/components/reader/wordLookup/useHighlightActions");
  const existing = [highlight({ id: "left", startOffset: 0, endOffset: 3 })];
  const h = harness(null, { textContent: "abcdef" });

  await useHighlightActions(existing, h.add, h.remove, h.proseRef)
    .handleAddNote(ANCHOR, "yellow", () => assert.fail("editor must not open"));
  t.mock.timers.tick(80);

  assert.equal(h.added[0]?.quote, "abcd");
  assert.deepEqual(h.removed, []);
});
