import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const providerSource = readFileSync(
  new URL("../src/components/ReaderHighlightsProvider.tsx", import.meta.url),
  "utf8",
);
const popoverSource = readFileSync(
  new URL(
    "../src/components/reader/wordLookup/HighlightEditPopover.tsx",
    import.meta.url,
  ),
  "utf8",
);
const notesPanelSource = readFileSync(
  new URL("../src/components/reader/ReaderNotesPanel.tsx", import.meta.url),
  "utf8",
);
const highlightsApiSource = readFileSync(
  new URL("../src/components/reader/useHighlightsApi.ts", import.meta.url),
  "utf8",
);

test("ReaderHighlightsProvider forwards causal delete options", () => {
  assert.match(
    providerSource,
    /async \(id: string, options\?: RemoveHighlightOptions\)[\s\S]*await apiRemove\(id, options\)/,
  );
});

test("Reader note editors prevent draft changes during an in-flight save", () => {
  assert.match(popoverSource, /disabled=\{savingNote\}/);
  assert.match(notesPanelSource, /disabled=\{saving\}/);
});

test("Reader highlight recreation waits for a queued delete at the same anchor", () => {
  assert.match(
    highlightsApiSource,
    /pendingDeletes\.current\.get\(anchorKey\)[\s\S]*queueCreate\(pendingDelete\.clientMutationId\)/,
  );
  assert.match(
    highlightsApiSource,
    /const anchorKey = pendingAnchorKey\(articleId, pending\.input\);[\s\S]*const completion = queueMutation\([\s\S]*pendingDeletes\.current\.set\(anchorKey, pendingDelete\);[\s\S]*const result = await completion;/,
  );
  assert.match(
    highlightsApiSource,
    /const anchorKey = pendingAnchorKey\(articleId, existing\);[\s\S]*const completion = queueMutation\([\s\S]*pendingDeletes\.current\.set\(anchorKey, pendingDelete\);[\s\S]*const result = await completion;/,
  );
});
