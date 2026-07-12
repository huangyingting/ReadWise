import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const READER_LAYOUT_CSS = join(ROOT, "src/app/styles/reader-layout.css");

function readerRootRule(css: string): string {
  const match = css.match(/#reader-root\s*\{[\s\S]*?\n\}/);
  assert.ok(match, "Expected #reader-root rule in reader-layout.css");
  return match[0];
}

test("#reader-root keeps 100vh fallback before 100dvh override", () => {
  const css = readFileSync(READER_LAYOUT_CSS, "utf8");
  const rule = readerRootRule(css);

  const fallbackIndex = rule.indexOf("min-height: 100vh;");
  const overrideIndex = rule.indexOf("min-height: 100dvh;");

  assert.notEqual(fallbackIndex, -1, "Expected min-height: 100vh fallback in #reader-root");
  assert.notEqual(overrideIndex, -1, "Expected min-height: 100dvh override in #reader-root");
  assert.ok(
    fallbackIndex < overrideIndex,
    "Expected #reader-root to declare 100vh first, then 100dvh override",
  );
});
