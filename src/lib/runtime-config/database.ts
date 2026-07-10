/**
 * Database infrastructure configuration (server-only).
 *
 * Provides typed helpers for database-related operational config that callers
 * should not read directly from process.env.
 *
 * @server-only — Must never be imported from a "use client" file.
 */
import { dirname, isAbsolute, join } from "node:path";
import { envValue, positiveIntEnv, type ConfigIssue } from "./env";

export const SQLITE_PRISMA_SCHEMA_PATH = "prisma/schema.prisma";
export const POSTGRES_PRISMA_SCHEMA_PATH = "prisma/postgresql/schema.prisma";

const DEFAULT_PRISMA_SCHEMA_PATH = SQLITE_PRISMA_SCHEMA_PATH;
const DATABASE_SCHEMA_MISMATCH_CODE = "database_prisma_schema_mismatch";
const UNKNOWN_PRISMA_SCHEMA_PATH_CODE = "unknown_prisma_schema_path";
const POSTGRES_DATABASE_URL_PREFIXES = ["postgresql://", "postgres://"] as const;
const DB_QUERY_TIMING_DISABLED_VALUES = new Set(["0", "false", "off", "no"]);
const DEFAULT_DB_SLOW_QUERY_THRESHOLD_MS = 250;

type DatabaseProvider = "sqlite" | "postgresql";
type SchemaProvider = DatabaseProvider | "unknown";

function resolveFromCwd(path: string): string {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function databaseProviderFromUrl(databaseUrl: string | null = envValue("DATABASE_URL")): DatabaseProvider | null {
  if (!databaseUrl) return null;
  if (databaseUrl.startsWith("file:")) return "sqlite";
  if (POSTGRES_DATABASE_URL_PREFIXES.some((prefix) => databaseUrl.startsWith(prefix))) {
    return "postgresql";
  }
  return null;
}

function splitSqliteFileUrl(databaseUrl: string): { pathPart: string; suffix: string } {
  const value = databaseUrl.slice("file:".length);
  const suffixStart = value.search(/[?#]/);
  if (suffixStart < 0) return { pathPart: value, suffix: "" };
  return {
    pathPart: value.slice(0, suffixStart),
    suffix: value.slice(suffixStart),
  };
}

function isAbsoluteSqlitePath(pathPart: string): boolean {
  return (
    pathPart.startsWith("/") ||
    pathPart.startsWith("\\") ||
    pathPart.startsWith("//") ||
    /^[a-zA-Z]:[\\/]/.test(pathPart)
  );
}

function normalizeResolvedSqlitePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Normalizes SQLite `file:` URLs before passing them to runtime adapters.
 *
 * Prisma's schema convention treats `file:./dev.db` as relative to the schema
 * directory (`prisma/dev.db`). The `@prisma/adapter-better-sqlite3` adapter
 * resolves the same URL relative to `process.cwd()` unless we make it absolute,
 * which can accidentally create/use a root-level `dev.db`.
 */
export function databaseUrlForPrismaAdapter(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) return databaseUrl;

  const { pathPart, suffix } = splitSqliteFileUrl(databaseUrl);
  if (
    pathPart.length === 0 ||
    pathPart === ":memory:" ||
    suffix.toLowerCase().includes("mode=memory") ||
    isAbsoluteSqlitePath(pathPart)
  ) {
    return databaseUrl;
  }

  const schemaDir = dirname(prismaSchemaPath());
  return `file:${normalizeResolvedSqlitePath(join(schemaDir, pathPart))}${suffix}`;
}

export function prismaSchemaProviderFromPath(schemaPath = configuredPrismaSchemaPath()): SchemaProvider {
  const normalized = normalizePath(schemaPath);
  if (normalized === SQLITE_PRISMA_SCHEMA_PATH || normalized.endsWith(`/${SQLITE_PRISMA_SCHEMA_PATH}`)) {
    return "sqlite";
  }
  if (normalized === POSTGRES_PRISMA_SCHEMA_PATH || normalized.endsWith(`/${POSTGRES_PRISMA_SCHEMA_PATH}`)) {
    return "postgresql";
  }
  return "unknown";
}

export function configuredPrismaSchemaPath(): string {
  return envValue("PRISMA_SCHEMA_PATH") ?? DEFAULT_PRISMA_SCHEMA_PATH;
}

/**
 * Whether Prisma database query timing is enabled.
 *
 * Defaults on. Set DB_QUERY_TIMING_ENABLED=0/false/off/no to disable the
 * lightweight app-side metrics/tracing wrapper.
 */
export function dbQueryTimingEnabled(): boolean {
  const raw = envValue("DB_QUERY_TIMING_ENABLED");
  if (!raw) return true;
  return !DB_QUERY_TIMING_DISABLED_VALUES.has(raw.toLowerCase());
}

/**
 * App-side slow-query threshold in milliseconds.
 *
 * Used only for safe metrics/log events; PostgreSQL server-side slow logging is
 * configured separately with log_min_duration_statement.
 */
export function dbSlowQueryThresholdMs(): number {
  return positiveIntEnv("DB_SLOW_QUERY_THRESHOLD_MS", DEFAULT_DB_SLOW_QUERY_THRESHOLD_MS);
}

function schemaPathForProvider(provider: DatabaseProvider): string {
  return provider === "postgresql" ? POSTGRES_PRISMA_SCHEMA_PATH : SQLITE_PRISMA_SCHEMA_PATH;
}

function providerLabel(provider: DatabaseProvider): string {
  return provider === "postgresql" ? "PostgreSQL" : "SQLite";
}

export function prismaSchemaMismatchIssue(): ConfigIssue | null {
  const databaseProvider = databaseProviderFromUrl();
  if (!databaseProvider) return null;

  const schemaPath = configuredPrismaSchemaPath();
  const schemaProvider = prismaSchemaProviderFromPath(schemaPath);
  if (schemaProvider === databaseProvider) return null;

  if (schemaProvider === "unknown") {
    return {
      severity: "error",
      code: UNKNOWN_PRISMA_SCHEMA_PATH_CODE,
      message:
        `PRISMA_SCHEMA_PATH must be ${SQLITE_PRISMA_SCHEMA_PATH} for SQLite or ` +
        `${POSTGRES_PRISMA_SCHEMA_PATH} for PostgreSQL; the configured path is not recognized.`,
      env: ["PRISMA_SCHEMA_PATH"],
    };
  }

  const expectedPath = schemaPathForProvider(databaseProvider);
  return {
    severity: "error",
    code: DATABASE_SCHEMA_MISMATCH_CODE,
    message:
      `DATABASE_URL targets ${providerLabel(databaseProvider)}, but PRISMA_SCHEMA_PATH selects the ` +
      `${providerLabel(schemaProvider)} Prisma schema. Set PRISMA_SCHEMA_PATH=${expectedPath} ` +
      `or use a ${providerLabel(schemaProvider)} DATABASE_URL.`,
    env: ["DATABASE_URL", "PRISMA_SCHEMA_PATH"],
  };
}

export function assertProductionPrismaSchemaMatchesDatabase(): void {
  if (process.env.NODE_ENV !== "production") return;

  const mismatch = prismaSchemaMismatchIssue();
  if (mismatch) {
    throw new Error(mismatch.message);
  }
}

/**
 * Returns the absolute path to the Prisma schema file.
 *
 * Reads `PRISMA_SCHEMA_PATH` (defaults to `"prisma/schema.prisma"`).
 * Resolves relative paths against `process.cwd()`.
 */
export function prismaSchemaPath(): string {
  return resolveFromCwd(configuredPrismaSchemaPath());
}
