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

import { writeFileSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog, buildCatalogMarkdown } from "@/tools/api-catalog";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CATALOG_JSON = join(ROOT, "docs", "platform", "api-catalog.json");
const CATALOG_MD = join(ROOT, "docs", "platform", "api-catalog.md");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const jsonOnly = args.includes("--json-only");
const mdOnly = args.includes("--md-only");

const catalog = buildCatalog();

if (!dryRun) {
  if (!mdOnly) {
    writeFileSync(CATALOG_JSON, JSON.stringify(catalog, null, 2) + "\n");
    console.log(
      `✓ wrote ${relative(ROOT, CATALOG_JSON)} (${catalog.routeCount} routes, ${catalog.methodCount} methods)`,
    );
  }
  if (!jsonOnly) {
    writeFileSync(CATALOG_MD, buildCatalogMarkdown(catalog));
    console.log(`✓ wrote ${relative(ROOT, CATALOG_MD)}`);
  }
} else {
  console.log(JSON.stringify(catalog, null, 2));
}
