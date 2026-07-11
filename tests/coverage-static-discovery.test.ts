import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  classifyFile,
  discoverEligibleFiles,
  discoverRoutes,
  buildRouteInventory,
  isClientOnlyFile,
  isPureBarrelFile,
  isTypeOnlyFile,
  mergeWithCoverage,
  normalizePath,
  parseCoverageDebt,
  type DiscoveryDeps,
} from "../scripts/coverage-static-discovery";

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

test("normalizePath converts Windows backslashes to forward slashes", () => {
  // On POSIX, normalize doesn't change separators, but our function handles it
  assert.equal(normalizePath("src/lib/foo.ts"), "src/lib/foo.ts");
  assert.equal(normalizePath("src/lib/../lib/foo.ts"), "src/lib/foo.ts");
});

// ---------------------------------------------------------------------------
// File classification: type-only
// ---------------------------------------------------------------------------

test("isTypeOnlyFile detects pure type-only files", () => {
  assert.equal(isTypeOnlyFile(`
export type Foo = { bar: string };
export type Baz = number;
  `), true);

  assert.equal(isTypeOnlyFile(`
import type { Something } from "./other";

export type Foo = {
  bar: string;
  baz: number;
};

export interface Bar {
  hello: string;
}
  `), true);
});

test("isTypeOnlyFile detects multi-line function types", () => {
  assert.equal(isTypeOnlyFile(`
export type ExtractorFetch = (
  url: string,
  init?: { method?: string },
) => Promise<string>;
  `), true);
});

test("isTypeOnlyFile detects multi-line union types", () => {
  assert.equal(isTypeOnlyFile(`
export type DiscoveredUrlSource =
  | "api"
  | "archive"
  | "rss";
  `), true);
});

test("isTypeOnlyFile detects multi-line imports", () => {
  assert.equal(isTypeOnlyFile(`
import type {
  claimNextJob,
  completeJob,
} from "@/lib/jobs";

export type WorkerLogger = {
  info: (message: string) => void;
};
  `), true);
});

test("isTypeOnlyFile rejects files with runtime exports", () => {
  assert.equal(isTypeOnlyFile(`
export type Foo = { bar: string };
export const DEFAULT = 42;
  `), false);

  assert.equal(isTypeOnlyFile(`
export function hello() { return 1; }
  `), false);

  assert.equal(isTypeOnlyFile(`
export enum Status { Active, Inactive }
  `), false);
});

test("isTypeOnlyFile rejects files with no exports", () => {
  assert.equal(isTypeOnlyFile(`
type Foo = { bar: string };
  `), false);
});

// ---------------------------------------------------------------------------
// File classification: pure barrel
// ---------------------------------------------------------------------------

test("isPureBarrelFile detects single-line re-exports", () => {
  assert.equal(isPureBarrelFile(`
export { foo, bar } from "./module";
export * from "./other";
  `), true);
});

test("isPureBarrelFile detects export * as namespace", () => {
  assert.equal(isPureBarrelFile(`
export * as events from "@/lib/analytics/events";
export * as queries from "@/lib/analytics/queries";
  `), true);
});

test("isPureBarrelFile detects multi-line export blocks", () => {
  assert.equal(isPureBarrelFile(`
export {
  type RateLimitScope,
  checkRateLimit,
} from "@/lib/security/rate-limit/index";
export * from "@/lib/security/headers";
  `), true);
});

test("isPureBarrelFile detects type re-exports", () => {
  assert.equal(isPureBarrelFile(`
export type { Foo, Bar } from "./types";
export { baz } from "./impl";
  `), true);
});

test("isPureBarrelFile rejects files with runtime code", () => {
  assert.equal(isPureBarrelFile(`
export { foo } from "./module";
const x = 1;
  `), false);

  assert.equal(isPureBarrelFile(`
export * from "./other";
export function helper() {}
  `), false);
});

test("isPureBarrelFile rejects files with only comments", () => {
  assert.equal(isPureBarrelFile(`
// Just a comment
  `), false);
});

// ---------------------------------------------------------------------------
// File classification: client-only
// ---------------------------------------------------------------------------

test("isClientOnlyFile detects use client directive", () => {
  assert.equal(isClientOnlyFile('"use client";\nimport React from "react";'), true);
  assert.equal(isClientOnlyFile("'use client';\nimport React from 'react';"), true);
  assert.equal(isClientOnlyFile('// comment\n"use client";\n'), true);
});

test("isClientOnlyFile rejects server files", () => {
  assert.equal(isClientOnlyFile('import { prisma } from "@/lib/prisma";'), false);
  assert.equal(isClientOnlyFile('export function handler() {}'), false);
});

// ---------------------------------------------------------------------------
// classifyFile integration
// ---------------------------------------------------------------------------

test("classifyFile prioritizes client-only > type-only > pure-barrel > executable", () => {
  assert.equal(classifyFile('"use client";\nexport type Foo = {};'), "client-only");
  assert.equal(classifyFile('export type Foo = { x: number };'), "type-only");
  assert.equal(classifyFile('export * from "./mod";'), "pure-barrel");
  assert.equal(classifyFile('export const x = 1;'), "executable");
});

// ---------------------------------------------------------------------------
// Discovery with mock filesystem
// ---------------------------------------------------------------------------

function createMockDeps(files: Record<string, string>): DiscoveryDeps {
  const dirs: Record<string, string[]> = {};
  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const entry = parts[i];
      if (!dirs[dir]) dirs[dir] = [];
      if (!dirs[dir].includes(entry)) dirs[dir].push(entry);
    }
  }

  return {
    readDir: (dir: string) => {
      const normalized = dir.replace(/\\/g, "/");
      if (!dirs[normalized]) throw new Error(`ENOENT: ${normalized}`);
      return dirs[normalized];
    },
    readFile: (path: string) => {
      const normalized = path.replace(/\\/g, "/");
      if (!(normalized in files)) throw new Error(`ENOENT: ${normalized}`);
      return files[normalized];
    },
    stat: (path: string) => {
      const normalized = path.replace(/\\/g, "/");
      const isDir = normalized in dirs;
      return { isDirectory: () => isDir };
    },
  };
}

test("discoverEligibleFiles finds executable files and excludes type-only/barrels", () => {
  const deps = createMockDeps({
    "root/src/lib/runtime.ts": 'export const x = 1;',
    "root/src/lib/types.ts": 'export type Foo = { x: number };',
    "root/src/lib/barrel.ts": 'export * from "./runtime";',
    "root/src/lib/client.ts": '"use client";\nexport function onClick() {}',
    "root/scripts/tool.ts": 'export function run() {}',
    "root/scripts/helper.test.ts": 'import { test } from "node:test";',
  });

  const result = discoverEligibleFiles("root", ["src/lib", "scripts"], deps);

  assert.deepEqual(result.eligible, ["scripts/tool.ts", "src/lib/runtime.ts"]);
  assert.deepEqual(result.excluded, [
    { file: "src/lib/barrel.ts", reason: "pure-barrel" },
    { file: "src/lib/client.ts", reason: "client-only" },
    { file: "src/lib/types.ts", reason: "type-only" },
  ]);
});

test("discoverEligibleFiles: unimported executable files become synthetic 0%", () => {
  const deps = createMockDeps({
    "root/src/lib/tested.ts": 'export const tested = true;',
    "root/src/lib/untested.ts": 'export function unreachable() { return 1; }',
  });

  const result = discoverEligibleFiles("root", ["src/lib"], deps);
  assert.deepEqual(result.eligible, ["src/lib/tested.ts", "src/lib/untested.ts"]);

  // Simulate: only tested.ts appears in coverage
  const measuredFiles = new Set(["src/lib/tested.ts"]);
  const debtFiles = new Set<string>();
  const { syntheticZeroFiles } = mergeWithCoverage(result.eligible, measuredFiles, debtFiles);
  assert.deepEqual(syntheticZeroFiles, ["src/lib/untested.ts"]);
});

// ---------------------------------------------------------------------------
// Merge with coverage
// ---------------------------------------------------------------------------

test("mergeWithCoverage separates synthetic zeros from debt-excused", () => {
  const eligible = ["a.ts", "b.ts", "c.ts", "d.ts"];
  const measured = new Set(["a.ts", "b.ts"]);
  const debt = new Set(["c.ts"]);

  const result = mergeWithCoverage(eligible, measured, debt);
  assert.deepEqual(result.syntheticZeroFiles, ["d.ts"]);
  assert.deepEqual(result.debtExcusedFiles, ["c.ts"]);
});

// ---------------------------------------------------------------------------
// Debt configuration parsing
// ---------------------------------------------------------------------------

test("parseCoverageDebt validates well-formed debt config", () => {
  const config = JSON.stringify({
    maxFileDebt: 2,
    maxRouteDebt: 1,
    fileDebt: [
      { file: "src/lib/foo.ts", issue: "#100", owner: "Team", reason: "needs tests", deadline: "2027-01-01" },
      { file: "src/lib/bar.ts", issue: "#100", owner: "Team", reason: "needs tests", deadline: "2027-01-01" },
    ],
    routeDebt: [
      { route: "src/app/api/health/route.ts", issue: "#100", owner: "Team", reason: "needs tests", deadline: "2027-01-01" },
    ],
  });

  const files = new Set(["src/lib/foo.ts", "src/lib/bar.ts"]);
  const routes = new Set(["src/app/api/health/route.ts"]);
  const result = parseCoverageDebt(config, "2026-07-11", files, routes);

  assert.equal(result.maxFileDebt, 2);
  assert.equal(result.fileDebt.length, 2);
  assert.equal(result.routeDebt.length, 1);
});

test("parseCoverageDebt rejects missing fields", () => {
  const files = new Set(["src/lib/foo.ts"]);
  const routes = new Set<string>();

  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 1, maxRouteDebt: 0,
      fileDebt: [{ file: "src/lib/foo.ts", issue: "#1", owner: "X", reason: "" , deadline: "2027-01-01" }],
      routeDebt: [],
    }), "2026-07-11", files, routes),
    /missing or empty field "reason"/,
  );
});

test("parseCoverageDebt rejects glob patterns", () => {
  const files = new Set(["src/lib/foo.ts"]);
  const routes = new Set<string>();

  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 1, maxRouteDebt: 0,
      fileDebt: [{ file: "src/lib/*.ts", issue: "#1", owner: "X", reason: "y", deadline: "2027-01-01" }],
      routeDebt: [],
    }), "2026-07-11", files, routes),
    /glob patterns are not allowed/,
  );
});

test("parseCoverageDebt rejects duplicate paths", () => {
  const files = new Set(["src/lib/foo.ts"]);
  const routes = new Set<string>();

  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 2, maxRouteDebt: 0,
      fileDebt: [
        { file: "src/lib/foo.ts", issue: "#1", owner: "X", reason: "y", deadline: "2027-01-01" },
        { file: "src/lib/foo.ts", issue: "#1", owner: "X", reason: "y", deadline: "2027-01-01" },
      ],
      routeDebt: [],
    }), "2026-07-11", files, routes),
    /duplicate file path/,
  );
});

test("parseCoverageDebt rejects nonexistent paths", () => {
  const files = new Set(["src/lib/foo.ts"]);
  const routes = new Set<string>();

  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 1, maxRouteDebt: 0,
      fileDebt: [{ file: "src/lib/missing.ts", issue: "#1", owner: "X", reason: "y", deadline: "2027-01-01" }],
      routeDebt: [],
    }), "2026-07-11", files, routes),
    /file does not exist/,
  );
});

test("parseCoverageDebt rejects expired deadlines", () => {
  const files = new Set(["src/lib/foo.ts"]);
  const routes = new Set<string>();

  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 1, maxRouteDebt: 0,
      fileDebt: [{ file: "src/lib/foo.ts", issue: "#1", owner: "X", reason: "y", deadline: "2025-01-01" }],
      routeDebt: [],
    }), "2026-07-11", files, routes),
    /deadline expired/,
  );
});

test("parseCoverageDebt enforces ratchet maximum (new debt cannot grow)", () => {
  const files = new Set(["src/lib/a.ts", "src/lib/b.ts", "src/lib/c.ts"]);
  const routes = new Set<string>();

  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 2, maxRouteDebt: 0,
      fileDebt: [
        { file: "src/lib/a.ts", issue: "#1", owner: "X", reason: "y", deadline: "2027-01-01" },
        { file: "src/lib/b.ts", issue: "#1", owner: "X", reason: "y", deadline: "2027-01-01" },
        { file: "src/lib/c.ts", issue: "#1", owner: "X", reason: "y", deadline: "2027-01-01" },
      ],
      routeDebt: [],
    }), "2026-07-11", files, routes),
    /fileDebt count \(3\) exceeds ratchet maximum \(2\)/,
  );
});

test("parseCoverageDebt rejects invalid JSON", () => {
  assert.throws(
    () => parseCoverageDebt("not json", "2026-07-11", new Set(), new Set()),
    /invalid JSON/,
  );
});

test("parseCoverageDebt rejects invalid deadline format", () => {
  const files = new Set(["src/lib/foo.ts"]);
  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 1, maxRouteDebt: 0,
      fileDebt: [{ file: "src/lib/foo.ts", issue: "#1", owner: "X", reason: "y", deadline: "2027/01/01" }],
      routeDebt: [],
    }), "2026-07-11", files, new Set()),
    /deadline must be YYYY-MM-DD/,
  );
});

// ---------------------------------------------------------------------------
// Route inventory
// ---------------------------------------------------------------------------

test("buildRouteInventory categorizes routes correctly", () => {
  const allRoutes = [
    "src/app/api/health/route.ts",
    "src/app/api/admin/ingest/route.ts",
    "src/app/api/feed/route.ts",
  ];
  const covered = new Set(["src/app/api/feed/route.ts"]);
  const routeDebt = [
    { route: "src/app/api/admin/ingest/route.ts", issue: "#995", owner: "X", reason: "y", deadline: "2027-01-01" },
  ];

  const result = buildRouteInventory(allRoutes, covered, routeDebt);
  assert.deepEqual(result.coveredRoutes, ["src/app/api/feed/route.ts"]);
  assert.deepEqual(result.debtRoutes, ["src/app/api/admin/ingest/route.ts"]);
  assert.deepEqual(result.uncoveredRoutes, ["src/app/api/health/route.ts"]);
});

test("new untested routes fail without debt entry", () => {
  const allRoutes = ["src/app/api/new/route.ts", "src/app/api/old/route.ts"];
  const covered = new Set(["src/app/api/old/route.ts"]);
  const routeDebt: { route: string; issue: string; owner: string; reason: string; deadline: string }[] = [];

  const result = buildRouteInventory(allRoutes, covered, routeDebt);
  assert.deepEqual(result.uncoveredRoutes, ["src/app/api/new/route.ts"]);
  assert.ok(result.uncoveredRoutes.length > 0, "New untested route should fail");
});

// ---------------------------------------------------------------------------
// Route discovery with mock
// ---------------------------------------------------------------------------

test("discoverRoutes finds all route.ts files under src/app/api", () => {
  const deps = createMockDeps({
    "root/src/app/api/health/route.ts": "export function GET() {}",
    "root/src/app/api/admin/users/route.ts": "export function POST() {}",
    "root/src/app/api/admin/users/[id]/route.ts": "export function PUT() {}",
  });

  const routes = discoverRoutes("root", deps);
  assert.deepEqual(routes, [
    "src/app/api/admin/users/[id]/route.ts",
    "src/app/api/admin/users/route.ts",
    "src/app/api/health/route.ts",
  ]);
});

// ---------------------------------------------------------------------------
// Integration: full static denominator gate with fixtures
// ---------------------------------------------------------------------------

test("full gate: unimported executable file produces synthetic 0% failure", () => {
  const deps = createMockDeps({
    "root/src/lib/tested.ts": "export const tested = true;",
    "root/src/lib/untested-probe.ts": "export function probe() { return 1; }",
  });

  const discovery = discoverEligibleFiles("root", ["src/lib"], deps);
  assert.ok(discovery.eligible.includes("src/lib/untested-probe.ts"));

  const measuredFiles = new Set(["src/lib/tested.ts"]);
  const { syntheticZeroFiles } = mergeWithCoverage(
    discovery.eligible,
    measuredFiles,
    new Set(),
  );

  assert.ok(
    syntheticZeroFiles.includes("src/lib/untested-probe.ts"),
    "Unimported file must be synthetic 0%",
  );
});

test("full gate: debt-excused file does not appear as synthetic 0%", () => {
  const deps = createMockDeps({
    "root/src/lib/tested.ts": "export const tested = true;",
    "root/src/lib/debt-excused.ts": "export function excused() { return 1; }",
  });

  const discovery = discoverEligibleFiles("root", ["src/lib"], deps);
  const measuredFiles = new Set(["src/lib/tested.ts"]);
  const debtFiles = new Set(["src/lib/debt-excused.ts"]);
  const { syntheticZeroFiles, debtExcusedFiles } = mergeWithCoverage(
    discovery.eligible,
    measuredFiles,
    debtFiles,
  );

  assert.deepEqual(syntheticZeroFiles, []);
  assert.deepEqual(debtExcusedFiles, ["src/lib/debt-excused.ts"]);
});

// ---------------------------------------------------------------------------
// Real filesystem integration
// ---------------------------------------------------------------------------

test("discoverEligibleFiles on real project finds expected file count", () => {
  const result = discoverEligibleFiles(process.cwd());
  // Should find hundreds of eligible files
  assert.ok(result.eligible.length > 300, `Expected >300 eligible, got ${result.eligible.length}`);
  assert.ok(result.excluded.length > 20, `Expected >20 excluded, got ${result.excluded.length}`);
  // Should not include test files
  assert.ok(result.eligible.every(f => !f.endsWith(".test.ts")));
  // Should not include .d.ts files
  assert.ok(result.eligible.every(f => !f.endsWith(".d.ts")));
});

test("discoverRoutes on real project finds all API routes", () => {
  const routes = discoverRoutes(process.cwd());
  assert.ok(routes.length >= 100, `Expected >= 100 routes, got ${routes.length}`);
  assert.ok(routes.every(r => r.startsWith("src/app/api/")));
  assert.ok(routes.every(r => r.endsWith("route.ts")));
});

test("parseCoverageDebt validates the real coverage-debt.json", () => {
  const content = readFileSync("coverage-debt.json", "utf8");
  const discovery = discoverEligibleFiles(process.cwd());
  const routes = discoverRoutes(process.cwd());

  const result = parseCoverageDebt(
    content,
    "2026-07-11",
    new Set(discovery.eligible),
    new Set(routes),
  );

  assert.ok(result.maxFileDebt >= 0);
  assert.ok(result.maxRouteDebt >= 0);
  assert.ok(result.fileDebt.length <= result.maxFileDebt);
  assert.ok(result.routeDebt.length <= result.maxRouteDebt);
});

// ---------------------------------------------------------------------------
// Edge cases for coverage
// ---------------------------------------------------------------------------

test("isPureBarrelFile handles export type * from pattern", () => {
  assert.equal(isPureBarrelFile('export type * from "./types";'), true);
});

test("discoverEligibleFiles handles unreadable directories gracefully", () => {
  const deps = createMockDeps({
    "root/src/lib/ok.ts": "export const x = 1;",
  });
  // Override readDir to throw for a specific path
  const originalReadDir = deps.readDir;
  deps.readDir = (dir: string) => {
    if (dir.includes("broken")) throw new Error("EACCES");
    return originalReadDir(dir);
  };

  // Should not throw
  const result = discoverEligibleFiles("root", ["src/lib", "broken"], deps);
  assert.deepEqual(result.eligible, ["src/lib/ok.ts"]);
});

test("discoverEligibleFiles handles unstat-able files gracefully", () => {
  const deps = createMockDeps({
    "root/src/lib/ok.ts": "export const x = 1;",
    "root/src/lib/broken.ts": "export const y = 2;",
  });
  const originalStat = deps.stat;
  deps.stat = (path: string) => {
    if (path.includes("broken.ts")) throw new Error("EACCES");
    return originalStat(path);
  };

  const result = discoverEligibleFiles("root", ["src/lib"], deps);
  assert.deepEqual(result.eligible, ["src/lib/ok.ts"]);
});

test("discoverRoutes handles unreadable api dir gracefully", () => {
  const deps: DiscoveryDeps = {
    readDir: () => { throw new Error("ENOENT"); },
    readFile: () => "",
    stat: () => ({ isDirectory: () => false }),
  };
  const routes = discoverRoutes("root", deps);
  assert.deepEqual(routes, []);
});

test("parseCoverageDebt rejects non-object root", () => {
  assert.throws(
    () => parseCoverageDebt("[]", "2026-07-11", new Set(), new Set()),
    /root must be an object/,
  );
});

test("parseCoverageDebt rejects missing maxFileDebt", () => {
  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: -1, maxRouteDebt: 0, fileDebt: [], routeDebt: [],
    }), "2026-07-11", new Set(), new Set()),
    /maxFileDebt must be a non-negative integer/,
  );
});

test("parseCoverageDebt rejects non-array fileDebt", () => {
  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 0, maxRouteDebt: 0, fileDebt: "bad", routeDebt: [],
    }), "2026-07-11", new Set(), new Set()),
    /fileDebt must be an array/,
  );
});

test("parseCoverageDebt rejects non-object entries", () => {
  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 1, maxRouteDebt: 0, fileDebt: ["string"], routeDebt: [],
    }), "2026-07-11", new Set(), new Set()),
    /must be an object/,
  );
});

test("parseCoverageDebt route debt ratchet enforcement", () => {
  const routes = new Set(["src/app/api/a/route.ts", "src/app/api/b/route.ts"]);
  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 0, maxRouteDebt: 1,
      fileDebt: [],
      routeDebt: [
        { route: "src/app/api/a/route.ts", issue: "#1", owner: "X", reason: "y", deadline: "2027-01-01" },
        { route: "src/app/api/b/route.ts", issue: "#1", owner: "X", reason: "y", deadline: "2027-01-01" },
      ],
    }), "2026-07-11", new Set(), routes),
    /routeDebt count \(2\) exceeds ratchet maximum \(1\)/,
  );
});

test("parseCoverageDebt rejects duplicate routes", () => {
  const routes = new Set(["src/app/api/a/route.ts"]);
  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 0, maxRouteDebt: 2,
      fileDebt: [],
      routeDebt: [
        { route: "src/app/api/a/route.ts", issue: "#1", owner: "X", reason: "y", deadline: "2027-01-01" },
        { route: "src/app/api/a/route.ts", issue: "#1", owner: "X", reason: "y", deadline: "2027-01-01" },
      ],
    }), "2026-07-11", new Set(), routes),
    /duplicate route path/,
  );
});

test("parseCoverageDebt rejects nonexistent routes", () => {
  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 0, maxRouteDebt: 1,
      fileDebt: [],
      routeDebt: [
        { route: "src/app/api/missing/route.ts", issue: "#1", owner: "X", reason: "y", deadline: "2027-01-01" },
      ],
    }), "2026-07-11", new Set(), new Set()),
    /route does not exist/,
  );
});

test("parseCoverageDebt rejects expired route deadlines", () => {
  const routes = new Set(["src/app/api/a/route.ts"]);
  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 0, maxRouteDebt: 1,
      fileDebt: [],
      routeDebt: [
        { route: "src/app/api/a/route.ts", issue: "#1", owner: "X", reason: "y", deadline: "2020-01-01" },
      ],
    }), "2026-07-11", new Set(), routes),
    /deadline expired/,
  );
});

test("parseCoverageDebt rejects bad maxRouteDebt", () => {
  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 0, maxRouteDebt: 1.5, fileDebt: [], routeDebt: [],
    }), "2026-07-11", new Set(), new Set()),
    /maxRouteDebt must be a non-negative integer/,
  );
});

test("parseCoverageDebt rejects non-array routeDebt", () => {
  assert.throws(
    () => parseCoverageDebt(JSON.stringify({
      maxFileDebt: 0, maxRouteDebt: 0, fileDebt: [], routeDebt: "bad",
    }), "2026-07-11", new Set(), new Set()),
    /routeDebt must be an array/,
  );
});

test("discoverRoutes handles unstat-able entries gracefully", () => {
  const deps = createMockDeps({
    "root/src/app/api/ok/route.ts": "export function GET() {}",
    "root/src/app/api/broken/route.ts": "export function POST() {}",
  });
  const originalStat = deps.stat;
  deps.stat = (path: string) => {
    if (path.includes("broken")) throw new Error("EACCES");
    return originalStat(path);
  };

  const routes = discoverRoutes("root", deps);
  assert.deepEqual(routes, ["src/app/api/ok/route.ts"]);
});
