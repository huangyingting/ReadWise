/**
 * Database infrastructure configuration (server-only).
 *
 * Provides typed helpers for database-related operational config that callers
 * should not read directly from process.env.
 *
 * @server-only — Must never be imported from a "use client" file.
 */
import { isAbsolute, join } from "node:path";
import { envValue } from "@/lib/runtime-config/env";
import type { ConfigIssue } from "@/lib/runtime-config/env";

export const SQLITE_PRISMA_SCHEMA_PATH = "prisma/schema.prisma";
export const POSTGRES_PRISMA_SCHEMA_PATH = "prisma/postgresql/schema.prisma";

const DEFAULT_PRISMA_SCHEMA_PATH = SQLITE_PRISMA_SCHEMA_PATH;
const DATABASE_SCHEMA_MISMATCH_CODE = "database_prisma_schema_mismatch";
const UNKNOWN_PRISMA_SCHEMA_PATH_CODE = "unknown_prisma_schema_path";
const POSTGRES_DATABASE_URL_PREFIXES = ["postgresql://", "postgres://"] as const;

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
