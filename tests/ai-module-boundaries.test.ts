process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(TEST_DIR, "..");
const AI_DIR = resolve(ROOT_DIR, "src/lib/ai");
const SRC_DIR = resolve(ROOT_DIR, "src");

const PRIVATE_AI_IMPORTS = new Set([
  "@/lib/ai/facade",
  "@/lib/ai/provider",
  "@/lib/ai/registry",
  "@/lib/ai/runner",
  "@/lib/ai/azure-provider",
  "@/lib/ai/ledger",
]);

const INTERNAL_BARREL_IMPORTS = new Set(["@/lib/ai", "@/lib/ai/index"]);

function walkFiles(dir: string, out: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) {
      continue;
    }
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function parseModuleSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  const importOrExport = /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  const requireCall = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

  for (const re of [importOrExport, dynamicImport, requireCall]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      specs.add(match[1]);
    }
  }
  return [...specs];
}

function relPath(absPath: string): string {
  return relative(ROOT_DIR, absPath).replaceAll("\\", "/");
}

function resolveAiImport(importer: string, specifier: string): string | null {
  const candidates: string[] = [];

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const base = resolve(dirname(importer), specifier);
    candidates.push(`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx"));
  } else if (specifier === "@/lib/ai" || specifier === "@/lib/ai/index") {
    candidates.push(resolve(AI_DIR, "index.ts"));
  } else if (specifier.startsWith("@/lib/ai/")) {
    const sub = specifier.slice("@/lib/ai/".length);
    const base = resolve(AI_DIR, sub);
    candidates.push(`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx"));
  } else {
    return null;
  }

  for (const candidate of candidates) {
    try {
      const rel = relPath(candidate);
      if (rel.startsWith("src/lib/ai/")) {
        readFileSync(candidate, "utf8");
        return rel;
      }
    } catch {
      // Candidate doesn't exist; keep searching.
    }
  }

  return null;
}

function detectCycles(graph: Map<string, string[]>): string[][] {
  const cycles = new Set<string>();

  function normalizeCycle(nodes: string[]): string {
    const forward = [...nodes];
    const backward = [...nodes].reverse();
    const rotations = (items: string[]) =>
      items.map((_, i) => [...items.slice(i), ...items.slice(0, i)].join(" -> "));
    const canon = [...rotations(forward), ...rotations(backward)].sort()[0];
    return canon;
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

test("ai public barrel exposes only the stable facade + budget API", async () => {
  const ai = await import("@/lib/ai");
  const expectedExports = [
    "aiModelName",
    "aiProviderCapabilities",
    "chatComplete",
    "chatCompleteWithMeta",
    "getAiBudgetStatus",
    "getAiContext",
    "isAiConfigured",
    "runWithAiContext",
  ].sort();

  const actualExports = Object.keys(ai).sort();
  assert.deepEqual(actualExports, expectedExports);

  for (const privateSymbol of [
    "getAiProvider",
    "runAiRequest",
    "AzureOpenAiProvider",
    "recordAiInvocation",
    "getOrCreateArticleAi",
    "getOrCreateSelectionAi",
    "checkAiBudget",
    "assertAiQuota",
  ]) {
    assert.equal(privateSymbol in ai, false, `${privateSymbol} must stay private to ai internals`);
  }
});

test("non-ai source modules do not import private ai internals", () => {
  const sourceFiles = walkFiles(SRC_DIR);
  const violations: string[] = [];

  for (const file of sourceFiles) {
    const rel = relPath(file);
    if (rel.startsWith("src/lib/ai/")) continue;
    const text = readFileSync(file, "utf8");
    const imports = parseModuleSpecifiers(text);
    for (const specifier of imports) {
      if (PRIVATE_AI_IMPORTS.has(specifier)) {
        violations.push(`${rel} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("ai internal graph has no cycles and does not back-import the public barrel", () => {
  const aiFiles = walkFiles(AI_DIR)
    .filter((file) => relPath(file).endsWith(".ts"))
    .sort();

  const graph = new Map<string, string[]>();
  const barrelBackImports: string[] = [];

  for (const file of aiFiles) {
    const rel = relPath(file);
    const text = readFileSync(file, "utf8");
    const imports = parseModuleSpecifiers(text);

    if (rel !== "src/lib/ai/index.ts") {
      for (const specifier of imports) {
        if (INTERNAL_BARREL_IMPORTS.has(specifier)) {
          barrelBackImports.push(`${rel} -> ${specifier}`);
        }
      }
    }

    const deps: string[] = [];
    for (const specifier of imports) {
      const resolved = resolveAiImport(file, specifier);
      if (resolved) deps.push(resolved);
    }
    graph.set(rel, [...new Set(deps)].sort());
  }

  assert.deepEqual(barrelBackImports, []);

  const cycles = detectCycles(graph);
  assert.deepEqual(
    cycles,
    [],
    `Detected ai import cycle(s): ${cycles.map((cycle) => cycle.join(" -> ")).join(" | ")}`,
  );
});
