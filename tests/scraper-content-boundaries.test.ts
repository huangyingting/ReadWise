import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(TEST_DIR, "..");
const SRC_DIR = resolve(ROOT_DIR, "src");

const IMPORT_RE =
  /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g;

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const absolute = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolute, out);
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(absolute);
  }
  return out;
}

function relPath(absolute: string): string {
  return relative(ROOT_DIR, absolute).replaceAll("\\", "/");
}

function importsFor(file: string): string[] {
  const specs: string[] = [];
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(IMPORT_RE)) {
    specs.push(match[1] ?? "");
  }
  return specs;
}

function assertNoImportPrefixViolations(
  files: string[],
  forbiddenPrefixes: readonly string[],
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const spec of importsFor(file)) {
      if (forbiddenPrefixes.some((prefix) => spec === prefix || spec.startsWith(`${prefix}/`))) {
        violations.push(`${relPath(file)} -> ${spec}`);
      }
    }
  }
  return violations.sort();
}

function resolveKnownModule(specifier: string): string | null {
  const aliasPrefix = "@/lib/";
  if (!specifier.startsWith(aliasPrefix)) return null;
  const pathPart = specifier.slice(aliasPrefix.length);
  return `src/lib/${pathPart}${pathPart.endsWith(".ts") ? "" : ".ts"}`;
}

function detectCycles(graph: Map<string, string[]>): string[][] {
  const cycles = new Set<string>();

  function normalizeCycle(nodes: string[]): string {
    const forward = [...nodes];
    const backward = [...nodes].reverse();
    const rotations = (items: string[]) =>
      items.map((_, index) => [...items.slice(index), ...items.slice(0, index)].join(" -> "));
    return [...rotations(forward), ...rotations(backward)].sort()[0] ?? "";
  }

  for (const start of graph.keys()) {
    const stack: Array<{ node: string; path: string[] }> = [{ node: start, path: [start] }];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      for (const next of graph.get(current.node) ?? []) {
        if (next === start && current.path.length > 1) {
          cycles.add(normalizeCycle(current.path));
          continue;
        }
        if (current.path.includes(next)) continue;
        stack.push({ node: next, path: [...current.path, next] });
      }
    }
  }

  return [...cycles].map((cycle) => cycle.split(" -> "));
}

test("canonical text-match normalization is centralized", () => {
  const NORMALIZE_RE = /\.replace\(\s*\/\\s\+\/g,\s*" "\)\.trim\(\)\.toLowerCase\(\)/;
  const matches = walkFiles(resolve(SRC_DIR, "lib"))
    .filter((file) => NORMALIZE_RE.test(readFileSync(file, "utf8")))
    .map(relPath)
    .sort();

  assert.deepEqual(matches, ["src/lib/text/normalize-match.ts"]);
});

test("scraper/content-pipeline/sanitize/processing ownership boundaries remain one-way", () => {
  const scraperFiles = walkFiles(resolve(SRC_DIR, "lib/scraper"));
  const contentPipelineFiles = walkFiles(resolve(SRC_DIR, "lib/content-pipeline"));
  const processingFiles = walkFiles(resolve(SRC_DIR, "lib/processing"));
  const sanitizeFiles = [resolve(SRC_DIR, "lib/sanitize.ts")];

  const violations = [
    ...assertNoImportPrefixViolations(scraperFiles, ["@/lib/content-pipeline", "@/lib/processing"]),
    ...assertNoImportPrefixViolations(contentPipelineFiles, ["@/lib/scraper", "@/lib/processing"]),
    ...assertNoImportPrefixViolations(processingFiles, [
      "@/lib/scraper",
      "@/lib/content-pipeline",
      "@/lib/sanitize",
    ]),
    ...assertNoImportPrefixViolations(sanitizeFiles, [
      "@/lib/scraper",
      "@/lib/content-pipeline",
      "@/lib/processing",
    ]),
  ].sort();

  assert.deepEqual(violations, []);
});

test("boundary modules are cycle-free", () => {
  const modules = [
    "src/lib/scraper/extract.ts",
    "src/lib/scraper/cleanup.ts",
    "src/lib/scraper/normalize.ts",
    "src/lib/scraper/declutter.ts",
    "src/lib/content-pipeline/index.ts",
    "src/lib/sanitize.ts",
    "src/lib/processing/processor.ts",
    "src/lib/text/normalize-match.ts",
  ];
  const moduleSet = new Set(modules);
  const graph = new Map<string, string[]>();

  for (const modulePath of modules) {
    const absolute = resolve(ROOT_DIR, modulePath);
    const deps = importsFor(absolute)
      .map(resolveKnownModule)
      .filter((dep): dep is string => dep != null && moduleSet.has(dep));
    graph.set(modulePath, [...new Set(deps)].sort());
  }

  assert.deepEqual(detectCycles(graph), []);
});
