process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ModuleBoundaryConfig = {
  name: "learning" | "engagement" | "lexical";
  alias: string;
  dir: string;
  disallowedInternalImportPrefixes?: string[];
};

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(TEST_DIR, "..");

const MODULES: ModuleBoundaryConfig[] = [
  {
    name: "learning",
    alias: "@/lib/learning",
    dir: resolve(ROOT_DIR, "src/lib/learning"),
  },
  {
    name: "engagement",
    alias: "@/lib/engagement",
    dir: resolve(ROOT_DIR, "src/lib/engagement"),
  },
  {
    name: "lexical",
    alias: "@/lib/lexical",
    dir: resolve(ROOT_DIR, "src/lib/lexical"),
    disallowedInternalImportPrefixes: [
      "@/lib/learning",
      "@/lib/vocabulary/service",
      "@/lib/vocabulary/schemas",
      "@/lib/content-pipeline",
      "@/lib/processing/processor",
    ],
  },
];

const BARREL_SUFFIXES = new Set(["", "/index"]);
const AMBIGUOUS_VOCAB_ALIAS = ["@/lib", "vocabulary"].join("/");

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

function relPath(absPath: string): string {
  return relative(ROOT_DIR, absPath).replaceAll("\\", "/");
}

function parseModuleSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  const importOrExport = /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  const requireCall = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

  for (const re of [importOrExport, dynamicImport, requireCall]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      specs.add(match[1] ?? "");
    }
  }
  return [...specs];
}

function isBarrelImport(specifier: string, alias: string): boolean {
  return [...BARREL_SUFFIXES].some((suffix) => specifier === `${alias}${suffix}`);
}

function resolveModuleImport(
  importer: string,
  specifier: string,
  config: ModuleBoundaryConfig,
): string | null {
  const candidates: string[] = [];

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const base = resolve(dirname(importer), specifier);
    candidates.push(`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx"));
  } else if (isBarrelImport(specifier, config.alias)) {
    candidates.push(resolve(config.dir, "index.ts"));
  } else if (specifier.startsWith(`${config.alias}/`)) {
    const sub = specifier.slice(`${config.alias}/`.length);
    const base = resolve(config.dir, sub);
    candidates.push(`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx"));
  } else {
    return null;
  }

  for (const candidate of candidates) {
    try {
      const rel = relPath(candidate);
      if (rel.startsWith(`src/lib/${config.name}/`)) {
        readFileSync(candidate, "utf8");
        return rel;
      }
    } catch {
      // Candidate missing; continue.
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

test("learning barrel keeps mastery/SRS APIs while hiding helper internals", async () => {
  const learning = await import("@/lib/learning");

  for (const required of [
    "applySm2",
    "buildCloze",
    "gradeCloze",
    "recordWordExposure",
    "recordWordReview",
    "getWordMastery",
    "updateArticleMastery",
    "recordSkillEvidence",
    "recordQuizAttempt",
    "getDueFlashcards",
    "gradeFlashcard",
    "getReviewSummary",
    "diagnoseWeakAreas",
    "buildWeeklyPlan",
    "gatherStudyDiagnostics",
    "generateStudyPlan",
    "convertHighlightToReviewCard",
    "recordTodayReflection",
  ]) {
    assert.equal(required in learning, true, `learning barrel missing ${required}`);
  }

  for (const internal of [
    "bestEffortMastery",
    "clamp01",
    "parseStringArray",
    "validateBoundedScore",
    "validateCountScore",
    "computeCountScorePct",
    "findOrCreateIdempotent",
    "SKILLS",
    "isSkill",
  ]) {
    assert.equal(internal in learning, false, `learning barrel should keep ${internal} internal`);
  }
});

test("engagement barrel exposes only cross-domain read services", async () => {
  const engagement = await import("@/lib/engagement");
  assert.deepEqual(Object.keys(engagement).sort(), [
    "getActivityHeatmap",
    "getFluencyTrend",
    "getProgress",
    "getProgressMap",
    "getProgressSummaries",
    "getReadingSpeedStats",
    "getStreakSummary",
    "listInProgressArticles",
  ]);
});

test("lexical barrel remains lexical-only and excludes learning/provider internals", async () => {
  const lexical = await import("@/lib/lexical");
  assert.deepEqual(Object.keys(lexical).sort(), [
    "CONTRACTIONS",
    "IRREGULAR_BASES",
    "WORDS_PAGE_SIZE",
    "getFilteredSavedWords",
    "getSavedWordSet",
    "getSavedWords",
    "lemmaFor",
    "lookupWord",
    "morphCandidates",
    "normalizeCandidates",
    "saveWord",
    "unsaveWord",
  ]);

  for (const forbidden of [
    "buildCloze",
    "gradeCloze",
    "FallbackDictionaryProvider",
    "FreeDictionaryProvider",
    "LocalDictionaryProvider",
    "defaultProvider",
  ]) {
    assert.equal(forbidden in lexical, false, `lexical barrel must not export ${forbidden}`);
  }
});

test("study schemas module exposes only route validation contracts", async () => {
  const schemas = await import("@/lib/study/schemas");
  assert.deepEqual(Object.keys(schemas).sort(), [
    "GRADES",
    "flashcardGradeBody",
    "parseClozeQuery",
    "parseWordsQuery",
  ]);
});

test("vocabulary service/schema modules stay explicit and no bare alias imports remain", async () => {
  const service = await import("@/lib/vocabulary/service");
  assert.deepEqual(Object.keys(service).sort(), ["getOrCreateArticleVocabulary"]);

  const schemas = await import("@/lib/vocabulary/schemas");
  assert.deepEqual(Object.keys(schemas).sort(), [
    "eraseSavedWordContextBody",
    "parseExportQuery",
    "saveWordBody",
    "unsaveBatchBody",
    "unsaveWordBody",
  ]);

  const violations: string[] = [];
  for (const file of [...walkFiles(resolve(ROOT_DIR, "src")), ...walkFiles(resolve(ROOT_DIR, "tests"))]) {
    const rel = relPath(file);
    for (const specifier of parseModuleSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier === AMBIGUOUS_VOCAB_ALIAS) {
        violations.push(`${rel} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

for (const config of MODULES) {
  test(`${config.name} internals are cycle-free and never back-import their barrel`, () => {
    const files = walkFiles(config.dir)
      .filter((file) => relPath(file).endsWith(".ts"))
      .sort();

    const graph = new Map<string, string[]>();
    const barrelBackImports: string[] = [];

    for (const file of files) {
      const rel = relPath(file);
      const imports = parseModuleSpecifiers(readFileSync(file, "utf8"));

      if (rel !== `src/lib/${config.name}/index.ts`) {
        for (const specifier of imports) {
          if (isBarrelImport(specifier, config.alias)) {
            barrelBackImports.push(`${rel} -> ${specifier}`);
          }
        }
      }

      const deps: string[] = [];
      for (const specifier of imports) {
        const resolved = resolveModuleImport(file, specifier, config);
        if (resolved) deps.push(resolved);
      }
      graph.set(rel, [...new Set(deps)].sort());
    }

    assert.deepEqual(barrelBackImports, []);

    const cycles = detectCycles(graph);
    assert.deepEqual(
      cycles,
      [],
      `Detected ${config.name} import cycle(s): ${cycles.map((cycle) => cycle.join(" -> ")).join(" | ")}`,
    );
  });

  if (config.disallowedInternalImportPrefixes && config.disallowedInternalImportPrefixes.length > 0) {
    test(`${config.name} internals keep dependency boundaries away from frozen vocabulary/pipeline seams`, () => {
      const violations: string[] = [];
      const files = walkFiles(config.dir)
        .filter((file) => relPath(file).endsWith(".ts"))
        .sort();

      for (const file of files) {
        const rel = relPath(file);
        for (const specifier of parseModuleSpecifiers(readFileSync(file, "utf8"))) {
          for (const prefix of config.disallowedInternalImportPrefixes ?? []) {
            if (specifier === prefix || specifier.startsWith(`${prefix}/`)) {
              violations.push(`${rel} -> ${specifier}`);
            }
          }
        }
      }

      assert.deepEqual(violations, []);
    });
  }
}
