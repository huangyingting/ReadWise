/**
 * API catalog generator CLI (REF-070).
 *
 * Thin wrapper around {@link buildCatalog} / {@link buildCatalogMarkdown} from
 * `src/lib/api-catalog.ts`.  Writes the catalog artifacts to:
 *   - `docs/platform/api-catalog.json`  — machine-readable catalog consumed by tests.
 *   - `docs/platform/api-catalog.md`    — human-readable reference.
 *
 * Usage (from repo root):
 *   npm run api-catalog
 *
 *   # Flags:
 *   --dry-run    Print JSON to stdout without writing files.
 *   --json-only  Skip writing docs/platform/api-catalog.md.
 *   --md-only    Skip writing docs/platform/api-catalog.json.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog, buildCatalogMarkdown } from "@/tools/api-catalog";
import type { ApiCatalog } from "@/tools/api-catalog";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CATALOG_JSON = join(ROOT, "docs", "platform", "api-catalog.json");
const CATALOG_MD = join(ROOT, "docs", "platform", "api-catalog.md");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const jsonOnly = args.includes("--json-only");
const mdOnly = args.includes("--md-only");

const catalog = buildCatalog();

/**
 * Returns the JSON catalog with `generatedAt` removed, serialised
 * deterministically — used to check whether the *content* has changed so the
 * generator is idempotent: if nothing changed we reuse the existing timestamp
 * and avoid a spurious git diff.
 */
function contentHash(c: ApiCatalog): string {
  const { generatedAt: _, ...rest } = c;
  return JSON.stringify(rest);
}

if (!dryRun) {
  if (!mdOnly) {
    // Only write (and update the timestamp) when route content has changed.
    let skipJson = false;
    try {
      const existing: ApiCatalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"));
      if (contentHash(existing) === contentHash(catalog)) {
        skipJson = true;
        console.log(`✓ ${relative(ROOT, CATALOG_JSON)} is up to date (no route changes)`);
      }
    } catch {
      // File missing or unparseable — write unconditionally.
    }
    if (!skipJson) {
      writeFileSync(CATALOG_JSON, JSON.stringify(catalog, null, 2) + "\n");
      console.log(
        `✓ wrote ${relative(ROOT, CATALOG_JSON)} (${catalog.routeCount} routes, ${catalog.methodCount} methods)`,
      );
    }
  }
  if (!jsonOnly) {
    const freshMd = buildCatalogMarkdown(catalog);
    // Same idempotency: skip writing the MD when only the timestamp line differs.
    let skipMd = false;
    try {
      const existingMd = readFileSync(CATALOG_MD, "utf8");
      // Strip volatile generated-date lines before comparing.
      const normalize = (s: string) =>
        s
          .replace(/^> Last generated: .+$/m, "")
          .replace(/^updated: ".+"$/m, "");
      if (normalize(existingMd) === normalize(freshMd)) {
        skipMd = true;
        console.log(`✓ ${relative(ROOT, CATALOG_MD)} is up to date (no route changes)`);
      }
    } catch {
      // File missing — write unconditionally.
    }
    if (!skipMd) {
      writeFileSync(CATALOG_MD, freshMd);
      console.log(`✓ wrote ${relative(ROOT, CATALOG_MD)}`);
    }
  }
} else {
  console.log(JSON.stringify(catalog, null, 2));
}
