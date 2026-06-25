import path from "node:path";

const DEFAULT_E2E_DATABASE_URL = "file:./e2e.db";
const SAFE_E2E_DATABASE_BASENAME = /^e2e(?:[-_.][A-Za-z0-9_.-]+)?\.db$/;

export function expectedE2eDatabaseUrl(): string {
  return process.env.PLAYWRIGHT_DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;
}

function sqliteDatabaseBasename(databaseUrl: string): string | null {
  const withoutQuery = databaseUrl.split(/[?#]/, 1)[0];
  if (!withoutQuery.startsWith("file:")) {
    return null;
  }

  const filePath = withoutQuery.slice("file:".length).replaceAll("\\", "/");
  if (!filePath) {
    return null;
  }

  return path.posix.basename(filePath);
}

/**
 * Asserts that the active DATABASE_URL is an isolated E2E SQLite database,
 * refusing to run destructive resets against production-like or dev databases.
 *
 * Guards:
 * 1. DATABASE_URL must be set.
 * 2. DATABASE_URL must equal the Playwright E2E database URL (PLAYWRIGHT_DATABASE_URL
 *    or the default "file:./e2e.db").
 * 3. The SQLite file basename must match the pattern e2e*.db.
 */
export function assertSafeE2eDatabaseUrl({
  databaseUrl = process.env.DATABASE_URL,
  expectedDatabaseUrl = expectedE2eDatabaseUrl(),
}: {
  databaseUrl?: string;
  expectedDatabaseUrl?: string;
} = {}): void {
  if (!databaseUrl) {
    throw new Error("Refusing to reset E2E database: DATABASE_URL is not set.");
  }

  if (databaseUrl !== expectedDatabaseUrl) {
    throw new Error(
      "Refusing to reset E2E database: DATABASE_URL does not match the Playwright E2E database URL.",
    );
  }

  const basename = sqliteDatabaseBasename(databaseUrl);
  if (!basename || !SAFE_E2E_DATABASE_BASENAME.test(basename)) {
    throw new Error(
      "Refusing to reset E2E database: DATABASE_URL must point to an isolated e2e*.db SQLite file.",
    );
  }
}
