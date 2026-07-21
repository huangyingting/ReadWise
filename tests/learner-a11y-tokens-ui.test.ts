/**
 * Source-level UI/a11y governance checks for learner loading and reader controls (#1219).
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

test("progress loading announces route loading while hiding skeleton visuals", () => {
  const src = readSrc("src/app/(app)/progress/loading.tsx");

  assert.ok(src.includes('aria-busy="true"'), "sets aria-busy on the top container");
  assert.ok(src.includes('role="status"'), "announces loading to screen readers");
  assert.ok(src.includes("Loading progress…"), "uses progress-specific status copy");
  assert.ok(src.includes("<div aria-hidden>"), "keeps visual skeletons hidden");
  assert.ok(!src.includes('className="listing-container" aria-hidden'), "outer container is not hidden");
});

test("reader loading announces article loading while preserving hidden skeleton sections", () => {
  const src = readSrc("src/app/(app)/reader/[id]/loading.tsx");

  assert.ok(src.includes('className="reader-layout" aria-busy="true"'), "sets aria-busy on reader layout");
  assert.ok(src.includes('role="status"'), "announces loading to screen readers");
  assert.ok(src.includes("Loading article…"), "uses article-specific status copy");
  assert.ok(src.includes("reader-controls\" aria-hidden"), "keeps toolbar skeleton hidden");
  assert.ok(src.includes("reader-article-header\" aria-hidden"), "keeps header skeleton hidden");
});

test("ArticleDictation uses shared panel state primitives for loading, error, and empty states", () => {
  const src = readSrc("src/components/ArticleDictation.tsx");

  assert.ok(src.includes("@/components/ui/ReaderToolPanelState"), "imports shared panel states");
  assert.ok(src.includes("PanelLoading"), "uses PanelLoading");
  assert.ok(src.includes("PanelError"), "uses PanelError");
  assert.ok(src.includes("PanelEmpty"), "uses PanelEmpty");
  assert.ok(src.includes('<PanelLoading message="Loading narration…" />'), "replaces raw loading paragraph");
  assert.ok(src.includes('message={panel.errorMsg ?? "Could not load narration."}'), "preserves error copy");
  assert.ok(!src.includes('<p className="tts-error"'), "removes raw tts-error paragraph");
  assert.ok(!src.includes('<p className="muted">Loading narration…</p>'), "removes raw muted loading state");
});

for (const rel of [
  "src/app/styles/reader-panel-bilingual.css",
  "src/app/styles/study.css",
]) {
  test(`${rel} has no raw hex fallbacks in token var() calls`, () => {
    const src = readSrc(rel).replace(/#\d+/g, "");
    assert.ok(
      !/var\(--[^)]*,\s*#[0-9a-fA-F]{3,8}[^)]*\)/.test(src),
      "must not use raw hex fallbacks inside var()",
    );
  });
}
