import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("direct network producers preserve their pre-request purge generation for fallback queueing", () => {
  const highlights = source(
    "../src/components/reader/useHighlightsApi.ts",
  );
  const inlineNote = source("../src/components/InlineNoteEditor.tsx");
  const progress = source("../src/components/ReaderProgress.tsx");
  const quiz = source(
    "../src/components/reader/study/useArticleQuizPanel.ts",
  );
  const today = source("../src/lib/offline/today-client.ts");

  assert.match(
    highlights,
    /const generation = captureOfflineMutationGeneration\(\);[\s\S]*fetch\(readerHighlightsEndpoint\(articleId\)[\s\S]*queueCreate\(\)/,
  );
  assert.match(
    highlights,
    /queueMutation\(\{[\s\S]*type: "highlight\.create"[\s\S]*generation,/,
  );
  assert.match(
    inlineNote,
    /const generation = captureOfflineMutationGeneration\(\);[\s\S]*requestJson\([\s\S]*OFFLINE_ACTOR_HEADER[\s\S]*queueNoteEdit\([\s\S]*generation/,
  );
  assert.match(
    progress,
    /const generation = captureOfflineMutationGeneration\(\);[\s\S]*fetch\([\s\S]*queueOffline\(\)/,
  );
  assert.match(
    progress,
    /dedupeKey: `progress:\$\{articleId\}:\$\{localDate\.localDate\}`/,
  );
  assert.match(
    quiz,
    /const generation = captureOfflineMutationGeneration\(\);[\s\S]*fetch\(endpoint[\s\S]*submitMutation\(\{[\s\S]*generation,/,
  );
  assert.match(
    today,
    /const generation = captureOfflineMutationGeneration\(\);[\s\S]*requestJson[\s\S]*queueMutation\(\{[\s\S]*generation,/,
  );
  for (const producer of [highlights, inlineNote, progress, quiz, today]) {
    assert.match(producer, /OFFLINE_ACTOR_HEADER/);
  }
});
