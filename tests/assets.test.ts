/**
 * Public asset governance tests — REF-080.
 *
 * Verifies that every path in ASSET_MANIFEST resolves to an existing file
 * under public/ and that icon/font constants are self-consistent.
 *
 * Run with: npm test -- --test-name-pattern assets
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ASSET_MANIFEST,
  ICON_SVG,
  ICON_192,
  ICON_512,
  APPLE_TOUCH_ICON,
  FONT_OPENDYSLEXIC_REGULAR,
  FONT_OPENDYSLEXIC_BOLD,
  OFFLINE_PAGE,
  OFFLINE_READER_PAGE,
} from "@/lib/assets";

// Resolve project root relative to this test file (tests/assets.test.ts → root).
const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const PUBLIC = join(ROOT, "public");

function publicPath(urlPath: string): string {
  // Strip leading slash and join with public dir.
  return join(PUBLIC, urlPath.replace(/^\//, ""));
}

// ---------------------------------------------------------------------------
// Asset manifest completeness
// ---------------------------------------------------------------------------

test("ASSET_MANIFEST has at least 9 entries", () => {
  assert.ok(ASSET_MANIFEST.length >= 9, `Expected ≥9 manifest entries, got ${ASSET_MANIFEST.length}`);
});

test("every ASSET_MANIFEST entry has a non-empty path, purpose, and references list", () => {
  for (const entry of ASSET_MANIFEST) {
    assert.ok(entry.path.startsWith("/"), `path must start with /: ${entry.path}`);
    assert.ok(entry.purpose.length > 0, `empty purpose for ${entry.path}`);
    assert.ok(entry.references.length > 0, `no references listed for ${entry.path}`);
  }
});

test("ASSET_MANIFEST has no duplicate paths", () => {
  const paths = ASSET_MANIFEST.map((e) => e.path);
  const unique = new Set(paths);
  assert.equal(unique.size, paths.length, "duplicate paths found in ASSET_MANIFEST");
});

// ---------------------------------------------------------------------------
// All manifested assets exist on disk
// ---------------------------------------------------------------------------

for (const entry of ASSET_MANIFEST) {
  test(`public asset exists on disk: ${entry.path}`, () => {
    const abs = publicPath(entry.path);
    assert.ok(existsSync(abs), `Missing public asset: ${abs}\n  Referenced by: ${entry.references.join(", ")}`);
  });
}

// ---------------------------------------------------------------------------
// Individual constant sanity checks
// ---------------------------------------------------------------------------

test("ICON_SVG exists under public/", () => {
  assert.ok(existsSync(publicPath(ICON_SVG)));
});

test("ICON_192 exists under public/", () => {
  assert.ok(existsSync(publicPath(ICON_192)));
});

test("ICON_512 exists under public/", () => {
  assert.ok(existsSync(publicPath(ICON_512)));
});

test("APPLE_TOUCH_ICON exists under public/", () => {
  assert.ok(existsSync(publicPath(APPLE_TOUCH_ICON)));
});

test("FONT_OPENDYSLEXIC_REGULAR exists under public/", () => {
  assert.ok(existsSync(publicPath(FONT_OPENDYSLEXIC_REGULAR)));
});

test("FONT_OPENDYSLEXIC_BOLD exists under public/", () => {
  assert.ok(existsSync(publicPath(FONT_OPENDYSLEXIC_BOLD)));
});

test("OFFLINE_PAGE exists under public/", () => {
  assert.ok(existsSync(publicPath(OFFLINE_PAGE)));
});

test("OFFLINE_READER_PAGE exists under public/", () => {
  assert.ok(existsSync(publicPath(OFFLINE_READER_PAGE)));
});

// ---------------------------------------------------------------------------
// Verify tokens.css references the same font paths as the constants
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

test("tokens.css @font-face src matches FONT_OPENDYSLEXIC_REGULAR constant", () => {
  const css = readFileSync(join(ROOT, "src/app/tokens.css"), "utf8");
  assert.ok(
    css.includes(`url("${FONT_OPENDYSLEXIC_REGULAR}")`),
    `tokens.css must reference ${FONT_OPENDYSLEXIC_REGULAR} — update both assets.ts and tokens.css together`,
  );
});

test("tokens.css @font-face src matches FONT_OPENDYSLEXIC_BOLD constant", () => {
  const css = readFileSync(join(ROOT, "src/app/tokens.css"), "utf8");
  assert.ok(
    css.includes(`url("${FONT_OPENDYSLEXIC_BOLD}")`),
    `tokens.css must reference ${FONT_OPENDYSLEXIC_BOLD} — update both assets.ts and tokens.css together`,
  );
});

// ---------------------------------------------------------------------------
// Service worker references the correct offline page paths
// ---------------------------------------------------------------------------

test("sw.js pre-caches OFFLINE_PAGE", () => {
  const sw = readFileSync(join(PUBLIC, "sw.js"), "utf8");
  assert.ok(
    sw.includes(`"${OFFLINE_PAGE}"`),
    `sw.js must cache ${OFFLINE_PAGE}`,
  );
});

test("sw.js pre-caches OFFLINE_READER_PAGE", () => {
  const sw = readFileSync(join(PUBLIC, "sw.js"), "utf8");
  assert.ok(
    sw.includes(`"${OFFLINE_READER_PAGE}"`),
    `sw.js must cache ${OFFLINE_READER_PAGE}`,
  );
});
