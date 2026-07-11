/**
 * Static coverage denominator discovery (Issue #992).
 *
 * Discovers eligible runtime TypeScript files on disk, classifies non-executable
 * (type-only, pure-barrel) exclusions deterministically, manages exact-path debt,
 * and builds a route inventory. Files absent from Node coverage become synthetic
 * 0% entries that fail the gate unless exact-debt-excused.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, normalize, posix, sep } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileClassification = "executable" | "type-only" | "pure-barrel" | "client-only";

export type DebtEntry = {
  file: string;
  issue: string;
  owner: string;
  reason: string;
  deadline: string;
};

export type RouteDebtEntry = {
  route: string;
  issue: string;
  owner: string;
  reason: string;
  deadline: string;
};

export type CoverageDebtConfig = {
  maxFileDebt: number;
  maxRouteDebt: number;
  fileDebt: DebtEntry[];
  routeDebt: RouteDebtEntry[];
};

export type DiscoveryResult = {
  eligible: string[];
  excluded: { file: string; reason: FileClassification }[];
};

export type RouteInventoryResult = {
  allRoutes: string[];
  coveredRoutes: string[];
  debtRoutes: string[];
  uncoveredRoutes: string[];
};

export type StaticDenominatorResult = {
  discovery: DiscoveryResult;
  syntheticZeroFiles: string[];
  debtExcusedFiles: string[];
  routeInventory: RouteInventoryResult;
};

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

/** Normalize a path to POSIX forward-slash form for consistent comparison. */
export function normalizePath(filePath: string): string {
  const normalized = normalize(filePath);
  if (sep === "\\") return normalized.split("\\").join("/");
  return normalized;
}

// ---------------------------------------------------------------------------
// File classification
// ---------------------------------------------------------------------------

/**
 * Conservative check: is this file type-only?
 * A file is type-only if it contains only: type/interface declarations (exported or not),
 * import statements, comments, and their body content (property definitions).
 * No runtime values: const, let, var, function, class, enum, or export default.
 */
export function isTypeOnlyFile(content: string): boolean {
  const lines = content.split(/\r?\n/);
  let hasExport = false;
  let insideBlock = 0;
  let inImport = false;
  let inTypeAssignment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty, comments
    if (
      trimmed === "" ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("*/")
    ) {
      continue;
    }

    // Multi-line import tracking
    if (inImport) {
      if (/from\s+["']/.test(trimmed) || trimmed.endsWith(";")) {
        inImport = false;
      }
      continue;
    }

    // Inside a multi-line type assignment (union/intersection without braces)
    if (inTypeAssignment) {
      if (trimmed.endsWith(";")) {
        inTypeAssignment = false;
      }
      continue;
    }

    // Track brace/paren depth for type/interface bodies
    if (insideBlock > 0) {
      insideBlock += (trimmed.match(/[{(]/g) || []).length;
      insideBlock -= (trimmed.match(/[})]/g) || []).length;
      continue;
    }

    // Import statements (single-line or start of multi-line)
    if (/^import\s/.test(trimmed)) {
      if (!(/from\s+["']/.test(trimmed) || trimmed.endsWith(";"))) {
        inImport = true;
      }
      continue;
    }

    // Type-only exports/declarations
    if (/^export\s+type\s/.test(trimmed) || /^export\s+interface\s/.test(trimmed)) {
      hasExport = true;
      const opens = (trimmed.match(/[{(]/g) || []).length;
      const closes = (trimmed.match(/[})]/g) || []).length;
      if (opens > closes) {
        insideBlock = opens - closes;
      } else if (/=\s*$/.test(trimmed)) {
        // Multi-line type assignment (e.g., union type)
        inTypeAssignment = true;
      }
      continue;
    }

    // Non-exported type/interface declarations
    if (/^type\s+\w/.test(trimmed) || /^interface\s+\w/.test(trimmed)) {
      const opens = (trimmed.match(/[{(]/g) || []).length;
      const closes = (trimmed.match(/[})]/g) || []).length;
      if (opens > closes) {
        insideBlock = opens - closes;
      } else if (/=\s*$/.test(trimmed)) {
        inTypeAssignment = true;
      }
      continue;
    }

    // Runtime export = not type-only
    if (/^export\s+(const|let|var|function|class|enum|default|async)/.test(trimmed)) {
      return false;
    }

    // Any runtime statement
    if (/^(const|let|var|function|class|enum|async|export\s*\{)/.test(trimmed)) {
      return false;
    }

    // Closing braces/parens/semicolons at top level
    if (/^[};)]/.test(trimmed)) continue;

    // Any other non-trivial line means it's not type-only
    return false;
  }

  return hasExport;
}

/**
 * Conservative check: is this file a pure re-export barrel?
 * A pure barrel only contains: comments, `export ... from "..."` statements,
 * `export type ... from "..."` statements, and empty lines.
 * Multi-line `export { ... } from "..."` blocks are handled.
 */
export function isPureBarrelFile(content: string): boolean {
  const lines = content.split(/\r?\n/);
  let hasExport = false;
  let inMultiLineExport = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty, comments
    if (
      trimmed === "" ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("*/")
    ) {
      continue;
    }

    // Inside a multi-line export { ... } from block
    if (inMultiLineExport) {
      if (/\}\s+from\s+["']/.test(trimmed) || /\}\s*from\s*["']/.test(trimmed)) {
        inMultiLineExport = false;
        hasExport = true;
      }
      continue;
    }

    // Single-line re-export patterns
    if (/^export\s+(?:type\s+)?\{[^}]*\}\s+from\s+["']/.test(trimmed)) {
      hasExport = true;
      continue;
    }
    if (/^export\s+\*\s+(?:as\s+\w+\s+)?from\s+["']/.test(trimmed)) {
      hasExport = true;
      continue;
    }
    if (/^export\s+type\s+\*\s+from\s+["']/.test(trimmed)) {
      hasExport = true;
      continue;
    }

    // Multi-line export start: `export {` or `export type {` without closing `} from`
    if (/^export\s+(?:type\s+)?\{/.test(trimmed) && !/\}\s*from\s*["']/.test(trimmed)) {
      inMultiLineExport = true;
      continue;
    }

    // Any other statement means it's not a pure barrel
    return false;
  }

  return hasExport && !inMultiLineExport;
}

/** Check if a file starts with "use client" directive. */
export function isClientOnlyFile(content: string): boolean {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/")) {
      continue;
    }
    return trimmed === '"use client";' || trimmed === "'use client';";
  }
  return false;
}

/** Classify a file based on its content. */
export function classifyFile(content: string): FileClassification {
  if (isClientOnlyFile(content)) return "client-only";
  if (isTypeOnlyFile(content)) return "type-only";
  if (isPureBarrelFile(content)) return "pure-barrel";
  return "executable";
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

export type DiscoveryDeps = {
  readDir: (dir: string) => string[];
  readFile: (path: string) => string;
  stat: (path: string) => { isDirectory: () => boolean };
};

const defaultDiscoveryDeps: DiscoveryDeps = {
  readDir: (dir) => readdirSync(dir),
  readFile: (path) => readFileSync(path, "utf8"),
  stat: (path) => statSync(path),
};

/**
 * Recursively discover TypeScript files under the given directories,
 * excluding test files, declaration files, and TSX.
 */
function walkDirectory(dir: string, rootDir: string, deps: DiscoveryDeps): string[] {
  const files: string[] = [];
  let entries: string[];
  try {
    entries = deps.readDir(dir);
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = deps.stat(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      files.push(...walkDirectory(fullPath, rootDir, deps));
    } else if (
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".d.ts") &&
      !entry.endsWith(".tsx")
    ) {
      // Relative path from root
      const relative = normalizePath(fullPath.slice(rootDir.length + 1));
      files.push(relative);
    }
  }
  return files;
}

/** Default directories eligible for native coverage. */
export const ELIGIBLE_DIRS = ["src/lib", "scripts", "eslint-rules"];

/**
 * Discover all eligible TypeScript files and classify them.
 */
export function discoverEligibleFiles(
  rootDir: string,
  dirs: string[] = ELIGIBLE_DIRS,
  deps: DiscoveryDeps = defaultDiscoveryDeps,
): DiscoveryResult {
  const eligible: string[] = [];
  const excluded: { file: string; reason: FileClassification }[] = [];

  for (const dir of dirs) {
    const fullDir = join(rootDir, dir);
    const files = walkDirectory(fullDir, rootDir, deps);

    for (const file of files) {
      const content = deps.readFile(join(rootDir, file));
      const classification = classifyFile(content);

      if (classification === "executable") {
        eligible.push(file);
      } else {
        excluded.push({ file, reason: classification });
      }
    }
  }

  eligible.sort();
  excluded.sort((a, b) => a.file.localeCompare(b.file));
  return { eligible, excluded };
}

// ---------------------------------------------------------------------------
// Debt configuration
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GLOB_CHARS_RE = /[*?{}]/;

function validateDebtEntry(entry: unknown, index: number, kind: string): void {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`${kind}[${index}]: must be an object`);
  }
  const obj = entry as Record<string, unknown>;
  const required = kind === "routeDebt"
    ? ["route", "issue", "owner", "reason", "deadline"]
    : ["file", "issue", "owner", "reason", "deadline"];

  for (const field of required) {
    if (typeof obj[field] !== "string" || (obj[field] as string).trim() === "") {
      throw new Error(`${kind}[${index}]: missing or empty field "${field}"`);
    }
  }

  const pathField = kind === "routeDebt" ? "route" : "file";
  const pathValue = obj[pathField] as string;
  if (GLOB_CHARS_RE.test(pathValue)) {
    throw new Error(`${kind}[${index}]: glob patterns are not allowed in "${pathField}": ${pathValue}`);
  }

  const deadline = obj.deadline as string;
  if (!ISO_DATE_RE.test(deadline)) {
    throw new Error(`${kind}[${index}]: deadline must be YYYY-MM-DD format: ${deadline}`);
  }
}

/**
 * Parse and validate a coverage debt configuration JSON string.
 */
export function parseCoverageDebt(
  jsonContent: string,
  today: string,
  existingFiles: Set<string>,
  existingRoutes: Set<string>,
): CoverageDebtConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonContent);
  } catch (err) {
    throw new Error(`coverage-debt.json: invalid JSON: ${(err as Error).message}`);
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("coverage-debt.json: root must be an object");
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.maxFileDebt !== "number" || !Number.isInteger(obj.maxFileDebt) || obj.maxFileDebt < 0) {
    throw new Error("coverage-debt.json: maxFileDebt must be a non-negative integer");
  }
  if (typeof obj.maxRouteDebt !== "number" || !Number.isInteger(obj.maxRouteDebt) || obj.maxRouteDebt < 0) {
    throw new Error("coverage-debt.json: maxRouteDebt must be a non-negative integer");
  }

  if (!Array.isArray(obj.fileDebt)) {
    throw new Error("coverage-debt.json: fileDebt must be an array");
  }
  if (!Array.isArray(obj.routeDebt)) {
    throw new Error("coverage-debt.json: routeDebt must be an array");
  }

  // Validate file debt entries
  const fileDebt: DebtEntry[] = [];
  const seenFiles = new Set<string>();
  for (let i = 0; i < obj.fileDebt.length; i++) {
    validateDebtEntry(obj.fileDebt[i], i, "fileDebt");
    const entry = obj.fileDebt[i] as DebtEntry;
    const normalized = normalizePath(entry.file);

    if (seenFiles.has(normalized)) {
      throw new Error(`fileDebt[${i}]: duplicate file path: ${normalized}`);
    }
    seenFiles.add(normalized);

    if (!existingFiles.has(normalized)) {
      throw new Error(`fileDebt[${i}]: file does not exist: ${normalized}`);
    }

    if (entry.deadline < today) {
      throw new Error(`fileDebt[${i}]: deadline expired (${entry.deadline} < ${today}): ${normalized}`);
    }

    fileDebt.push({ ...entry, file: normalized });
  }

  // Validate route debt entries
  const routeDebt: RouteDebtEntry[] = [];
  const seenRoutes = new Set<string>();
  for (let i = 0; i < obj.routeDebt.length; i++) {
    validateDebtEntry(obj.routeDebt[i], i, "routeDebt");
    const entry = obj.routeDebt[i] as RouteDebtEntry;
    const normalized = normalizePath(entry.route);

    if (seenRoutes.has(normalized)) {
      throw new Error(`routeDebt[${i}]: duplicate route path: ${normalized}`);
    }
    seenRoutes.add(normalized);

    if (!existingRoutes.has(normalized)) {
      throw new Error(`routeDebt[${i}]: route does not exist: ${normalized}`);
    }

    if (entry.deadline < today) {
      throw new Error(`routeDebt[${i}]: deadline expired (${entry.deadline} < ${today}): ${normalized}`);
    }

    routeDebt.push({ ...entry, route: normalized });
  }

  // Ratchet check
  if (fileDebt.length > obj.maxFileDebt) {
    throw new Error(
      `coverage-debt.json: fileDebt count (${fileDebt.length}) exceeds ratchet maximum (${obj.maxFileDebt})`,
    );
  }
  if (routeDebt.length > obj.maxRouteDebt) {
    throw new Error(
      `coverage-debt.json: routeDebt count (${routeDebt.length}) exceeds ratchet maximum (${obj.maxRouteDebt})`,
    );
  }

  return {
    maxFileDebt: obj.maxFileDebt as number,
    maxRouteDebt: obj.maxRouteDebt as number,
    fileDebt,
    routeDebt,
  };
}

// ---------------------------------------------------------------------------
// Route inventory
// ---------------------------------------------------------------------------

/**
 * Discover all API route files under src/app/api.
 */
export function discoverRoutes(
  rootDir: string,
  deps: DiscoveryDeps = defaultDiscoveryDeps,
): string[] {
  const apiDir = join(rootDir, "src/app/api");
  const routes: string[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = deps.readDir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = deps.stat(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry === "route.ts") {
        routes.push(normalizePath(fullPath.slice(rootDir.length + 1)));
      }
    }
  }

  walk(apiDir);
  routes.sort();
  return routes;
}

/**
 * Build route inventory: which routes are covered by tests, which are debt-excused,
 * which are uncovered.
 */
export function buildRouteInventory(
  allRoutes: string[],
  coveredFiles: Set<string>,
  routeDebt: RouteDebtEntry[],
): RouteInventoryResult {
  const debtPaths = new Set(routeDebt.map((d) => d.route));
  const coveredRoutes: string[] = [];
  const debtRoutes: string[] = [];
  const uncoveredRoutes: string[] = [];

  for (const route of allRoutes) {
    if (coveredFiles.has(route)) {
      coveredRoutes.push(route);
    } else if (debtPaths.has(route)) {
      debtRoutes.push(route);
    } else {
      uncoveredRoutes.push(route);
    }
  }

  return { allRoutes, coveredRoutes, debtRoutes, uncoveredRoutes };
}

// ---------------------------------------------------------------------------
// Merge discovery with coverage
// ---------------------------------------------------------------------------

export type CoverageFileInfo = {
  file: string;
  linePct: number;
};

/**
 * Merge static file discovery with measured coverage data.
 * Returns synthetic 0% files and debt-excused files.
 */
export function mergeWithCoverage(
  eligibleFiles: string[],
  measuredFiles: Set<string>,
  debtFiles: Set<string>,
): { syntheticZeroFiles: string[]; debtExcusedFiles: string[] } {
  const syntheticZeroFiles: string[] = [];
  const debtExcusedFiles: string[] = [];

  for (const file of eligibleFiles) {
    if (!measuredFiles.has(file)) {
      if (debtFiles.has(file)) {
        debtExcusedFiles.push(file);
      } else {
        syntheticZeroFiles.push(file);
      }
    }
  }

  syntheticZeroFiles.sort();
  debtExcusedFiles.sort();
  return { syntheticZeroFiles, debtExcusedFiles };
}
