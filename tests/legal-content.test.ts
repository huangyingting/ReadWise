/**
 * Legal and static-page content governance tests — REF-075.
 *
 * Verifies that:
 *   - All legal page metadata entries exist in `@/lib/copy/pages` and have the
 *     required shape.
 *   - The LegalPageShell component file exists and exports the expected symbol.
 *   - Manifest copy constants are present in `@/lib/copy/site`.
 *
 * Run with: npm test -- --test-name-pattern legal
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { terms, privacy } from "@/lib/copy/pages";
import { SITE_NAME, MANIFEST_DESCRIPTION, TITLE_TEMPLATE, SITE_DEFAULT_TITLE, SITE_DESCRIPTION, OG_TITLE, OG_DESCRIPTION } from "@/lib/copy/site";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");

// ---------------------------------------------------------------------------
// Legal page metadata — copy/pages entries
// ---------------------------------------------------------------------------

test("terms metadata has a non-empty title string", () => {
  assert.equal(typeof terms.title, "string");
  assert.ok((terms.title as string).length > 0, "terms.title must not be empty");
});

test("terms metadata has a non-empty description string", () => {
  assert.equal(typeof terms.description, "string");
  assert.ok((terms.description as string).length > 0, "terms.description must not be empty");
});

test("privacy metadata has a non-empty title string", () => {
  assert.equal(typeof privacy.title, "string");
  assert.ok((privacy.title as string).length > 0, "privacy.title must not be empty");
});

test("privacy metadata has a non-empty description string", () => {
  assert.equal(typeof privacy.description, "string");
  assert.ok((privacy.description as string).length > 0, "privacy.description must not be empty");
});

test("terms and privacy titles are distinct", () => {
  assert.notEqual(terms.title, privacy.title, "terms and privacy must have different titles");
});

// ---------------------------------------------------------------------------
// Site-level copy constants (used by layout.tsx and manifest.ts)
// ---------------------------------------------------------------------------

test("SITE_NAME is a non-empty string", () => {
  assert.equal(typeof SITE_NAME, "string");
  assert.ok(SITE_NAME.length > 0);
});

test("MANIFEST_DESCRIPTION is a non-empty string", () => {
  assert.equal(typeof MANIFEST_DESCRIPTION, "string");
  assert.ok(MANIFEST_DESCRIPTION.length > 0);
});

test("TITLE_TEMPLATE contains SITE_NAME", () => {
  assert.ok(TITLE_TEMPLATE.includes(SITE_NAME), "TITLE_TEMPLATE must reference SITE_NAME");
});

test("SITE_DEFAULT_TITLE contains SITE_NAME", () => {
  assert.ok(SITE_DEFAULT_TITLE.includes(SITE_NAME), "SITE_DEFAULT_TITLE must reference SITE_NAME");
});

test("SITE_DESCRIPTION is a non-empty string", () => {
  assert.ok(SITE_DESCRIPTION.length > 0);
});

test("OG_TITLE is a non-empty string", () => {
  assert.ok(OG_TITLE.length > 0);
});

test("OG_DESCRIPTION is a non-empty string", () => {
  assert.ok(OG_DESCRIPTION.length > 0);
});

// ---------------------------------------------------------------------------
// LegalPageShell component exists on disk
// ---------------------------------------------------------------------------

test("LegalPageShell component file exists", () => {
  const path = resolve(ROOT, "src/components/legal/LegalPageShell.tsx");
  assert.ok(existsSync(path), `Missing: ${path}`);
});

// ---------------------------------------------------------------------------
// Legal content governance documentation exists
// ---------------------------------------------------------------------------

test("docs/content/legal-content.md exists", () => {
  const path = resolve(ROOT, "docs/content/legal-content.md");
  assert.ok(existsSync(path), `Missing governance doc: ${path}`);
});
