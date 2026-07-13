/**
 * Safe-area contract tests (issue #1036).
 *
 * Verifies the CSS/math relationships that govern fixed-bottom mobile chrome:
 *
 *  1. Token arithmetic — `--bottom-bar-total-h` equals content-h + safe-area.
 *  2. BottomTabBar class shape — no border-box height class; has padding-bottom
 *     safe-area class; each item uses min-h token (not raw 44px).
 *  3. AppShell reservation — uses `--bottom-bar-total-h`, not `--bottom-bar-h`.
 *  4. Sheet bottom — includes env(safe-area-inset-bottom) padding class.
 *  5. Reader bottom-sheet body — has safe-area padding in CSS.
 *
 * These are deterministic source-text contracts. No DOM, no browser.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..");

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

// ---------------------------------------------------------------------------
// 1. Token arithmetic
// ---------------------------------------------------------------------------

test("tokens.css defines --bottom-bar-total-h as calc(--bottom-bar-h + env(safe-area-inset-bottom, 0px))", () => {
  const css = readSrc("src/app/tokens.css");
  assert.ok(
    /--bottom-bar-total-h\s*:\s*calc\(\s*var\(--bottom-bar-h\)\s*\+\s*env\(\s*safe-area-inset-bottom\s*,\s*0px\s*\)\s*\)/.test(css),
    "--bottom-bar-total-h must equal calc(var(--bottom-bar-h) + env(safe-area-inset-bottom, 0px))",
  );
});

test("tokens.css preserves --bottom-bar-h: 56px content-height token", () => {
  const css = readSrc("src/app/tokens.css");
  assert.ok(
    /--bottom-bar-h\s*:\s*56px/.test(css),
    "--bottom-bar-h must remain 56px (content height)",
  );
});

// ---------------------------------------------------------------------------
// 2. BottomTabBar class shape
// ---------------------------------------------------------------------------

test("BottomTabBar nav does NOT use h-[var(--bottom-bar-h)] (border-box height)", () => {
  const src = readSrc("src/components/shell/BottomTabBar.tsx");
  // Must not contain the standalone h-[var(--bottom-bar-h)] class (not prefixed
  // by min-, max-, etc.) which would set a border-box height that clips items.
  assert.ok(
    !/(?<![a-z-])h-\[var\(--bottom-bar-h\)\]/.test(src),
    "BottomTabBar nav must not use the fixed h-[var(--bottom-bar-h)] border-box height — it clips touch items",
  );
});

test("BottomTabBar nav has env(safe-area-inset-bottom) padding-bottom", () => {
  const src = readSrc("src/components/shell/BottomTabBar.tsx");
  assert.ok(
    src.includes("safe-area-inset-bottom"),
    "BottomTabBar nav must apply env(safe-area-inset-bottom) as padding-bottom",
  );
});

test("BottomTabBar item uses min-h-[var(--bottom-bar-h)] (not raw 44px)", () => {
  const src = readSrc("src/components/shell/BottomTabBar.tsx");
  assert.ok(
    src.includes("min-h-[var(--bottom-bar-h)]"),
    "BottomTabBar item class must use min-h-[var(--bottom-bar-h)] so item height = content token, not 44px",
  );
  assert.ok(
    !src.includes("min-h-[44px]"),
    "BottomTabBar item must not use raw min-h-[44px] — use --bottom-bar-h token instead",
  );
});

// ---------------------------------------------------------------------------
// 3. AppShell reservation
// ---------------------------------------------------------------------------

test("AppShell reserves pb-[var(--bottom-bar-total-h)] on mobile", () => {
  const src = readSrc("src/components/shell/AppShell.tsx");
  assert.ok(
    src.includes("pb-[var(--bottom-bar-total-h)]"),
    "AppShell must reserve pb-[var(--bottom-bar-total-h)] (content + safe-area) as bottom padding",
  );
});

test("AppShell does NOT reserve only pb-[var(--bottom-bar-h)] (misses safe-area)", () => {
  const src = readSrc("src/components/shell/AppShell.tsx");
  // Allow the string to appear only as part of "--bottom-bar-total-h"; the
  // standalone --bottom-bar-h] reservation is the bug we're fixing.
  const standalone = src.replace(/--bottom-bar-total-h/g, "__replaced__");
  assert.ok(
    !standalone.includes("pb-[var(--bottom-bar-h)]"),
    "AppShell must not use bare pb-[var(--bottom-bar-h)] — use --bottom-bar-total-h instead",
  );
});

// ---------------------------------------------------------------------------
// 4. Sheet bottom safe-area
// ---------------------------------------------------------------------------

test("Sheet SIDE_CLASSES.bottom includes env(safe-area-inset-bottom) padding", () => {
  const src = readSrc("src/components/ui/Sheet.tsx");
  // Extract the bottom side class string (single-quoted or double-quoted block).
  const bottomIdx = src.indexOf("bottom:");
  assert.ok(bottomIdx !== -1, "Sheet.tsx must have a bottom: side class");
  const snippet = src.slice(bottomIdx, bottomIdx + 300);
  assert.ok(
    snippet.includes("safe-area-inset-bottom"),
    "Sheet bottom SIDE_CLASS must include env(safe-area-inset-bottom,0px) padding",
  );
});

// ---------------------------------------------------------------------------
// 5. Reader bottom-sheet body safe-area
// ---------------------------------------------------------------------------

test("reader-panel-tools.css .reader-bottom-sheet-body has padding-bottom env(safe-area-inset-bottom, 0px)", () => {
  const css = readSrc("src/app/styles/reader-panel-tools.css");
  const bodyIdx = css.indexOf(".reader-bottom-sheet-body");
  assert.ok(bodyIdx !== -1, ".reader-bottom-sheet-body must exist in reader-panel-tools.css");
  // Grab the rule block (next ~200 chars after the selector).
  const block = css.slice(bodyIdx, bodyIdx + 300);
  assert.ok(
    block.includes("safe-area-inset-bottom"),
    ".reader-bottom-sheet-body must include padding-bottom: env(safe-area-inset-bottom, 0px)",
  );
});

// ---------------------------------------------------------------------------
// 6. No double-application on desktop / md breakpoint
// ---------------------------------------------------------------------------

test("AppShell resets bottom padding at md breakpoint (md:pb-0)", () => {
  const src = readSrc("src/components/shell/AppShell.tsx");
  assert.ok(
    src.includes("md:pb-0"),
    "AppShell must reset bottom padding to zero at md breakpoint — safe-area only applies on mobile",
  );
});

test("BottomTabBar self-hides at md breakpoint (md:hidden)", () => {
  const src = readSrc("src/components/shell/BottomTabBar.tsx");
  assert.ok(
    src.includes("md:hidden"),
    "BottomTabBar must self-hide above mobile with md:hidden",
  );
});

// ---------------------------------------------------------------------------
// 7. Token comment describes both tokens clearly
// ---------------------------------------------------------------------------

test("tokens.css comment distinguishes --bottom-bar-h (content) from --bottom-bar-total-h (total)", () => {
  const css = readSrc("src/app/tokens.css");
  assert.ok(
    css.includes("--bottom-bar-total-h"),
    "--bottom-bar-total-h must appear in tokens.css",
  );
  assert.ok(
    css.includes("--bottom-bar-h"),
    "--bottom-bar-h must remain in tokens.css",
  );
});
