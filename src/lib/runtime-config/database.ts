/**
 * Database infrastructure configuration (server-only).
 *
 * Provides typed helpers for database-related operational config that callers
 * should not read directly from process.env.
 *
 * @server-only — Must never be imported from a "use client" file.
 */
import { isAbsolute, join } from "node:path";
import {
  databaseProviderFromUrl as classifyDatabaseProvider,
  databaseUrlForPrismaAdapter as normalizeDatabaseUrlForPrismaAdapter,
  inspectDatabaseSchemaPairing,
  POSTGRES_PRISMA_SCHEMA_PATH,
  prismaSchemaProviderFromPath as classifyPrismaSchema,
  SQLITE_PRISMA_SCHEMA_PATH,
} from "@/lib/database-provider-policy.mjs";
import { envValue, positiveIntEnv, type ConfigIssue } from "./env";

export { POSTGRES_PRISMA_SCHEMA_PATH, SQLITE_PRISMA_SCHEMA_PATH };

const DEFAULT_PRISMA_SCHEMA_PATH = SQLITE_PRISMA_SCHEMA_PATH;
const DB_QUERY_TIMING_DISABLED_VALUES = new Set(["0", "false", "off", "no"]);
const DEFAULT_DB_SLOW_QUERY_THRESHOLD_MS = 250;

function resolveFromCwd(path: string): string {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

export function databaseProviderFromUrl(databaseUrl: string | null = envValue("DATABASE_URL")) {
  return classifyDatabaseProvider(databaseUrl);
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
  return normalizeDatabaseUrlForPrismaAdapter(
    databaseUrl,
    configuredPrismaSchemaPath(),
    process.cwd(),
  );
}

export function prismaSchemaProviderFromPath(schemaPath = configuredPrismaSchemaPath()) {
  return classifyPrismaSchema(schemaPath);
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

export function prismaSchemaMismatchIssue(): ConfigIssue | null {
  const pairing = inspectDatabaseSchemaPairing(
    envValue("DATABASE_URL"),
    configuredPrismaSchemaPath(),
  );
  if (pairing.ok || pairing.code === "invalid_database_url") return null;

  return {
    severity: "error",
    code: pairing.code,
    message: pairing.message,
    env: pairing.env,
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
