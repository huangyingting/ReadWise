process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ModuleBoundaryConfig = {
  name: "article-library" | "reader" | "recommendations" | "leveling";
  alias: string;
  dir: string;
  hasBarrel: boolean;
};

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(TEST_DIR, "..");

const BARREL_SUFFIXES = new Set(["", "/index"]);

const MODULES: ModuleBoundaryConfig[] = [
  {
    name: "article-library",
    alias: "@/lib/article-library",
    dir: resolve(ROOT_DIR, "src/lib/article-library"),
    hasBarrel: true,
  },
  {
    name: "reader",
    alias: "@/lib/reader",
    dir: resolve(ROOT_DIR, "src/lib/reader"),
    hasBarrel: false,
  },
  {
    name: "recommendations",
    alias: "@/lib/recommendations",
    dir: resolve(ROOT_DIR, "src/lib/recommendations"),
    hasBarrel: true,
  },
  {
    name: "leveling",
    alias: "@/lib/leveling",
    dir: resolve(ROOT_DIR, "src/lib/leveling"),
    hasBarrel: true,
  },
];

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
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
    candidates.push(
      `${base}.ts`,
      `${base}.tsx`,
      resolve(base, "index.ts"),
      resolve(base, "index.tsx"),
    );
  } else if (config.hasBarrel && isBarrelImport(specifier, config.alias)) {
    candidates.push(resolve(config.dir, "index.ts"));
  } else if (specifier.startsWith(`${config.alias}/`)) {
    const sub = specifier.slice(`${config.alias}/`.length);
    const base = resolve(config.dir, sub);
    candidates.push(
      `${base}.ts`,
      `${base}.tsx`,
      resolve(base, "index.ts"),
      resolve(base, "index.tsx"),
    );
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
      // Candidate does not exist.
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

test("article-library barrel preserves public identity for query/commands/collections seams", async () => {
  const [articleLibrary, policy, listings, mapper, listingResponse, moderation, collections] =
    await Promise.all([
      import("@/lib/article-library"),
      import("@/lib/article-library/policy"),
      import("@/lib/article-library/listings"),
      import("@/lib/article-library/mapper"),
      import("@/lib/article-library/listing-response"),
      import("@/lib/article-library/moderation"),
      import("@/lib/article-library/collections"),
    ]);

  assert.equal(articleLibrary.publicListableArticleWhere, policy.publicListableArticleWhere);
  assert.equal(articleLibrary.listPublishedArticles, listings.listPublishedArticles);
  assert.equal(articleLibrary.toListingArticle, mapper.toListingArticle);
  assert.equal(articleLibrary.buildArticleListResponse, listingResponse.buildArticleListResponse);
  assert.equal(articleLibrary.applyTakedown, moderation.applyTakedown);
  assert.equal(articleLibrary.getUserLists, collections.getUserLists);

  assert.equal("requireReadableArticle" in articleLibrary, false);
  assert.equal("listScoredPicksPage" in articleLibrary, false);
});

test("recommendations barrel preserves public identity and keeps internal helpers private", async () => {
  const [recommendations, context, picks, scoring, types] = await Promise.all([
    import("@/lib/recommendations"),
    import("@/lib/recommendations/context"),
    import("@/lib/recommendations/picks"),
    import("@/lib/recommendations/scoring"),
    import("@/lib/recommendations/types"),
  ]);

  assert.equal(recommendations.buildRecommendationContext, context.buildRecommendationContext);
  assert.equal(recommendations.listScoredPicksPage, picks.listScoredPicksPage);
  assert.equal(recommendations.scoreAndRankArticles, picks.scoreAndRankArticles);
  assert.equal(recommendations.scoreCandidate, scoring.scoreCandidate);
  assert.equal(recommendations.COMPONENT_WEIGHTS, types.COMPONENT_WEIGHTS);

  for (const internal of ["rankWithDiversity", "buildExplanationLines", "headlineReason"]) {
    assert.equal(internal in recommendations, false, `recommendations barrel should not export ${internal}`);
  }
});

test("recommendations is consumed by engagement orchestration (truthful non-leaf direction)", () => {
  const generatorPath = resolve(ROOT_DIR, "src/lib/engagement/today-session/generator.ts");
  const imports = parseModuleSpecifiers(readFileSync(generatorPath, "utf8"));
  assert.ok(
    imports.includes("@/lib/recommendations/picks"),
    "today-session generator should consume recommendations picks",
  );
});

test("recommendations context/type seams depend on leveling contracts, not difficulty module exports", () => {
  const recommendationSeamFiles = [
    resolve(ROOT_DIR, "src/lib/recommendations/index.ts"),
    resolve(ROOT_DIR, "src/lib/recommendations/context.ts"),
    resolve(ROOT_DIR, "src/lib/recommendations/types.ts"),
    resolve(ROOT_DIR, "src/lib/recommendations/diversity.ts"),
    resolve(ROOT_DIR, "src/lib/recommendations/explanations.ts"),
  ];
  const violations: string[] = [];

  for (const file of recommendationSeamFiles) {
    const rel = relPath(file);
    for (const specifier of parseModuleSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier === "@/lib/difficulty" || specifier.startsWith("@/lib/difficulty/")) {
        violations.push(`${rel} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("difficulty and leveling stay one-way dependencies (no import from recommendations)", () => {
  const files = [
    resolve(ROOT_DIR, "src/lib/difficulty.ts"),
    ...walkFiles(resolve(ROOT_DIR, "src/lib/leveling")).filter((file) => relPath(file).endsWith(".ts")),
  ];
  const violations: string[] = [];

  for (const file of files) {
    const rel = relPath(file);
    for (const specifier of parseModuleSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier === "@/lib/recommendations" || specifier.startsWith("@/lib/recommendations/")) {
        violations.push(`${rel} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("reader API routes use reader guard/schema/command seams; page-loader stays page-only", () => {
  const routeFiles = walkFiles(resolve(ROOT_DIR, "src/app/api/reader")).filter((file) =>
    relPath(file).endsWith("/route.ts"),
  );
  const pageLoaderViolations: string[] = [];
  let boundaryImportCount = 0;

  for (const file of routeFiles) {
    const rel = relPath(file);
    const imports = parseModuleSpecifiers(readFileSync(file, "utf8"));
    for (const specifier of imports) {
      if (specifier === "@/lib/reader/page-loader" || specifier.startsWith("@/lib/reader/page-loader/")) {
        pageLoaderViolations.push(`${rel} -> ${specifier}`);
      }
      if (specifier.startsWith("@/lib/reader/")) {
        boundaryImportCount += 1;
      }
    }
  }

  assert.deepEqual(pageLoaderViolations, []);
  assert.ok(boundaryImportCount > 0, "reader API routes should import reader guard/schema/commands");
});

for (const config of MODULES) {
  test(`${config.name} internals are cycle-free and avoid barrel back-imports`, () => {
    const files = walkFiles(config.dir)
      .filter((file) => relPath(file).endsWith(".ts"))
      .sort();

    const graph = new Map<string, string[]>();
    const barrelBackImports: string[] = [];

    for (const file of files) {
      const rel = relPath(file);
      const imports = parseModuleSpecifiers(readFileSync(file, "utf8"));

      const isBarrelFile = config.hasBarrel && rel === `src/lib/${config.name}/index.ts`;
      for (const specifier of imports) {
        if (isBarrelImport(specifier, config.alias) && !isBarrelFile) {
          barrelBackImports.push(`${rel} -> ${specifier}`);
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
      `Detected ${config.name} cycle(s): ${cycles.map((cycle) => cycle.join(" -> ")).join(" | ")}`,
    );
  });
}
