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
import { isMain, runScript } from "./lib/cli";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CATALOG_JSON = join(ROOT, "docs", "platform", "api-catalog.json");
const CATALOG_MD = join(ROOT, "docs", "platform", "api-catalog.md");

export type GenerateApiCatalogOptions = {
  dryRun: boolean;
  jsonOnly: boolean;
  mdOnly: boolean;
};

type GenerateApiCatalogDeps = {
  readFileSync: typeof readFileSync;
  writeFileSync: typeof writeFileSync;
  buildCatalog: typeof buildCatalog;
  buildCatalogMarkdown: typeof buildCatalogMarkdown;
  log: (...args: unknown[]) => void;
};

const generatedLinePattern = /^> Last generated: .+$/m;
const lastUpdatedPattern = /^last_updated: ".+"$/m;

export function parseArgs(argv: string[]): GenerateApiCatalogOptions {
  return {
    dryRun: argv.includes("--dry-run"),
    jsonOnly: argv.includes("--json-only"),
    mdOnly: argv.includes("--md-only"),
  };
}

/**
 * Returns the JSON catalog with `generatedAt` removed, serialised
 * deterministically — used to check whether the *content* has changed so the
 * generator is idempotent: if nothing changed we reuse the existing timestamp
 * and avoid a spurious git diff.
 */
export function contentHash(catalog: ApiCatalog): string {
  const { generatedAt: _generatedAt, ...rest } = catalog;
  return JSON.stringify(rest);
}

export function normalizeMarkdown(markdown: string): string {
  return markdown.replace(generatedLinePattern, "").replace(lastUpdatedPattern, "");
}

export function relativeCatalogPath(pathname: string): string {
  return relative(ROOT, pathname);
}

export function generateApiCatalog(
  options: GenerateApiCatalogOptions,
  deps: GenerateApiCatalogDeps = {
    readFileSync,
    writeFileSync,
    buildCatalog,
    buildCatalogMarkdown,
    log: console.log,
  },
): void {
  const catalog = deps.buildCatalog();

  if (options.dryRun) {
    deps.log(JSON.stringify(catalog, null, 2));
    return;
  }

  if (!options.mdOnly) {
    // Only write (and update the timestamp) when route content has changed.
    let skipJson = false;
    try {
      const existing: ApiCatalog = JSON.parse(deps.readFileSync(CATALOG_JSON, "utf8"));
      if (contentHash(existing) === contentHash(catalog)) {
        skipJson = true;
        deps.log(`✓ ${relativeCatalogPath(CATALOG_JSON)} is up to date (no route changes)`);
      }
    } catch {
      // File missing or unparseable — write unconditionally.
    }
    if (!skipJson) {
      deps.writeFileSync(CATALOG_JSON, JSON.stringify(catalog, null, 2) + "\n");
      deps.log(
        `✓ wrote ${relativeCatalogPath(CATALOG_JSON)} (${catalog.routeCount} routes, ${catalog.methodCount} methods)`,
      );
    }
  }

  if (!options.jsonOnly) {
    const freshMd = deps.buildCatalogMarkdown(catalog);

    // Same idempotency: skip writing the MD when only the timestamp line differs.
    let skipMd = false;
    try {
      const existingMd = deps.readFileSync(CATALOG_MD, "utf8");
      // Strip volatile generated-date lines before comparing.
      if (normalizeMarkdown(existingMd) === normalizeMarkdown(freshMd)) {
        skipMd = true;
        deps.log(`✓ ${relativeCatalogPath(CATALOG_MD)} is up to date (no route changes)`);
      }
    } catch {
      // File missing — write unconditionally.
    }
    if (!skipMd) {
      deps.writeFileSync(CATALOG_MD, freshMd);
      deps.log(`✓ wrote ${relativeCatalogPath(CATALOG_MD)}`);
    }
  }
}

export function main(argv: string[] = process.argv.slice(2)): number {
  generateApiCatalog(parseArgs(argv));
  return 0;
}

if (isMain(import.meta.url)) {
  runScript(async () => main(), "generate-api-catalog failed");
}
