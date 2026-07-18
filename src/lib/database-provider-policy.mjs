import { dirname, isAbsolute, join } from "node:path";

export const SQLITE_PRISMA_SCHEMA_PATH = "prisma/schema.prisma";
export const POSTGRES_PRISMA_SCHEMA_PATH = "prisma/postgresql/schema.prisma";

const POSTGRES_DATABASE_URL_PREFIXES = ["postgresql://", "postgres://"];

/** @typedef {"sqlite" | "postgresql"} DatabaseProvider */
/** @typedef {DatabaseProvider | "unknown"} SchemaProvider */
/** @typedef {"invalid_database_url" | "unknown_prisma_schema_path" | "database_prisma_schema_mismatch"} DatabaseConfigurationIssueCode */
/** @typedef {{ ok: true, provider: DatabaseProvider, schemaPath: string }} DatabaseSchemaPairingSuccess */
/** @typedef {{ ok: false, code: DatabaseConfigurationIssueCode, message: string, env: string[] }} DatabaseSchemaPairingFailure */
/** @typedef {DatabaseSchemaPairingSuccess | DatabaseSchemaPairingFailure} DatabaseSchemaPairing */

/**
 * @param {string | null | undefined} databaseUrl
 * @returns {DatabaseProvider | null}
 */
export function databaseProviderFromUrl(databaseUrl) {
  const value = databaseUrl?.trim();
  if (!value) return null;
  if (value.startsWith("file:") && value.length > "file:".length) return "sqlite";
  if (POSTGRES_DATABASE_URL_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return "postgresql";
  }
  return null;
}

/**
 * @param {string | null | undefined} databaseUrl
 * @returns {boolean}
 */
export function isSupportedDatabaseUrl(databaseUrl) {
  const value = databaseUrl?.trim();
  const provider = databaseProviderFromUrl(value);
  if (!value || !provider) return false;
  if (provider === "sqlite") return true;

  try {
    const { protocol } = new URL(value);
    return protocol === "postgresql:" || protocol === "postgres:";
  } catch {
    return false;
  }
}

/**
 * @param {string} schemaPath
 * @returns {SchemaProvider}
 */
export function prismaSchemaProviderFromPath(schemaPath) {
  const normalized = schemaPath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (
    normalized === SQLITE_PRISMA_SCHEMA_PATH ||
    normalized.endsWith(`/${SQLITE_PRISMA_SCHEMA_PATH}`)
  ) {
    return "sqlite";
  }
  if (
    normalized === POSTGRES_PRISMA_SCHEMA_PATH ||
    normalized.endsWith(`/${POSTGRES_PRISMA_SCHEMA_PATH}`)
  ) {
    return "postgresql";
  }
  return "unknown";
}

/**
 * @param {DatabaseProvider} provider
 * @returns {string}
 */
function providerLabel(provider) {
  return provider === "postgresql" ? "PostgreSQL" : "SQLite";
}

/**
 * @param {DatabaseProvider} provider
 * @returns {string}
 */
function schemaPathForProvider(provider) {
  return provider === "postgresql"
    ? POSTGRES_PRISMA_SCHEMA_PATH
    : SQLITE_PRISMA_SCHEMA_PATH;
}

/**
 * @param {string | null | undefined} databaseUrl
 * @param {string | null | undefined} schemaPath
 * @returns {DatabaseSchemaPairing}
 */
export function inspectDatabaseSchemaPairing(
  databaseUrl,
  schemaPath = SQLITE_PRISMA_SCHEMA_PATH,
) {
  const databaseProvider = databaseProviderFromUrl(databaseUrl);
  if (!databaseProvider || !isSupportedDatabaseUrl(databaseUrl)) {
    return {
      ok: false,
      code: "invalid_database_url",
      message: "DATABASE_URL must be set to a SQLite file: URL or PostgreSQL URL.",
      env: ["DATABASE_URL"],
    };
  }

  const selectedSchemaPath = schemaPath?.trim() || SQLITE_PRISMA_SCHEMA_PATH;
  const schemaProvider = prismaSchemaProviderFromPath(selectedSchemaPath);
  if (schemaProvider === "unknown") {
    return {
      ok: false,
      code: "unknown_prisma_schema_path",
      message:
        `PRISMA_SCHEMA_PATH must be ${SQLITE_PRISMA_SCHEMA_PATH} for SQLite or ` +
        `${POSTGRES_PRISMA_SCHEMA_PATH} for PostgreSQL; the configured path is not recognized.`,
      env: ["PRISMA_SCHEMA_PATH"],
    };
  }

  if (schemaProvider !== databaseProvider) {
    return {
      ok: false,
      code: "database_prisma_schema_mismatch",
      message:
        `DATABASE_URL targets ${providerLabel(databaseProvider)}, but PRISMA_SCHEMA_PATH selects the ` +
        `${providerLabel(schemaProvider)} Prisma schema. Set PRISMA_SCHEMA_PATH=${schemaPathForProvider(databaseProvider)} ` +
        `or use a ${providerLabel(schemaProvider)} DATABASE_URL.`,
      env: ["DATABASE_URL", "PRISMA_SCHEMA_PATH"],
    };
  }

  return {
    ok: true,
    provider: databaseProvider,
    schemaPath: selectedSchemaPath,
  };
}

function splitSqliteFileUrl(databaseUrl) {
  const value = databaseUrl.slice("file:".length);
  const suffixStart = value.search(/[?#]/);
  if (suffixStart < 0) return { pathPart: value, suffix: "" };
  return {
    pathPart: value.slice(0, suffixStart),
    suffix: value.slice(suffixStart),
  };
}

function isAbsoluteSqlitePath(pathPart) {
  return (
    pathPart.startsWith("/") ||
    pathPart.startsWith("\\") ||
    pathPart.startsWith("//") ||
    /^[a-zA-Z]:[\\/]/.test(pathPart)
  );
}

/**
 * @param {string} databaseUrl
 * @param {string} schemaPath
 * @param {string} [cwd]
 * @returns {string}
 */
export function databaseUrlForPrismaAdapter(
  databaseUrl,
  schemaPath,
  cwd = process.cwd(),
) {
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

  const absoluteSchemaPath = isAbsolute(schemaPath) ? schemaPath : join(cwd, schemaPath);
  const resolvedPath = join(dirname(absoluteSchemaPath), pathPart).replace(/\\/g, "/");
  return `file:${resolvedPath}${suffix}`;
}