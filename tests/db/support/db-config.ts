/**
 * Shared PostgreSQL integration test configuration.
 *
 * Guards the live database suite behind RUN_DB_INTEGRATION=1 and an isolated,
 * loopback-only test database so destructive tests cannot target shared data.
 */

import path from "node:path";

const POSTGRES_PROTOCOLS = ["postgresql://", "postgres://"] as const;
const POSTGRES_URL_PROTOCOLS = new Set(["postgresql:", "postgres:"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const TEST_TARGET_SEGMENT = /(?:^|[-_.])(test|testing|ci|e2e)(?:$|[-_.])/i;
const SQLITE_FILE_URL_PREFIX = "file:";
const POSTGRES_TARGET_OVERRIDE_PARAMS = new Set([
  "database",
  "dbname",
  "host",
  "hostaddr",
  "port",
  "service",
  "servicefile",
]);

export const databaseUrl = process.env.DATABASE_URL ?? "";
export const isPostgres = POSTGRES_PROTOCOLS.some((protocol) => databaseUrl.startsWith(protocol));

function hasTestTargetSegment(value: string): boolean {
  return TEST_TARGET_SEGMENT.test(value);
}

function isSafeSqliteTarget(value: string): boolean {
  const withoutQuery = value.split(/[?#]/, 1)[0];
  if (!withoutQuery.startsWith(SQLITE_FILE_URL_PREFIX)) return false;

  const filePath = withoutQuery.slice(SQLITE_FILE_URL_PREFIX.length).replaceAll("\\", "/");
  return filePath.length > 0 && hasTestTargetSegment(path.posix.basename(filePath));
}

function isSafePostgresTarget(value: string): boolean {
  try {
    const url = new URL(value);
    if (!POSTGRES_URL_PROTOCOLS.has(url.protocol)) return false;
    if (!LOOPBACK_HOSTS.has(url.hostname)) return false;
    if (
      [...url.searchParams.keys()].some((key) =>
        POSTGRES_TARGET_OVERRIDE_PARAMS.has(key.toLowerCase()),
      )
    ) {
      return false;
    }

    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    return hasTestTargetSegment(databaseName);
  } catch {
    return false;
  }
}

export function isSafeIntegrationDatabaseUrl(value: string): boolean {
  return isSafeSqliteTarget(value) || isSafePostgresTarget(value);
}

const integrationRequested = process.env.RUN_DB_INTEGRATION === "1";
if (integrationRequested && !isSafeIntegrationDatabaseUrl(databaseUrl)) {
  throw new Error(
    "Refusing to run database integration tests: DATABASE_URL must target an isolated " +
      "loopback database whose database or SQLite filename contains test, ci, or e2e.",
  );
}

export const enabled = integrationRequested;

/** Prefix used for all integration-test rows so cleanup helpers can sweep them. */
export const PREFIX = "dbit_";
