/**
 * Schema Parity Check (REF-069)
 *
 * Verifies that prisma/schema.prisma and prisma/postgresql/schema.prisma are
 * byte-identical except for the datasource provider line:
 *
 *   SQLite:     provider = "sqlite"
 *   PostgreSQL: provider = "postgresql"
 *
 * Also verifies that both migration directories contain the same set of named
 * migrations (timestamps/names). Migration SQL content is legitimately
 * engine-specific (e.g. PostgreSQL emits CREATE TYPE for enums), but the
 * migration history — the ordered list of named migration directories — must
 * stay aligned so that both engines track the same logical schema version.
 *
 * Exit codes:
 *   0 — schemas and migrations are in parity
 *   1 — drift detected; details printed to stderr
 *
 * Usage:
 *   npm run schema:check-parity
 *   node --experimental-strip-types scripts/check-schema-parity.ts
 */
import { readFile, readdir } from "node:fs/promises";
import { runScript, isMain } from "./lib/cli";

const SQLITE_SCHEMA = "prisma/schema.prisma";
const POSTGRES_SCHEMA = "prisma/postgresql/schema.prisma";
const SQLITE_MIGRATIONS = "prisma/migrations";
const POSTGRES_MIGRATIONS = "prisma/postgresql/migrations";

/** Substitutes the SQLite provider so the schema can be compared to the PostgreSQL one. */
function normalizeToPostgres(sqliteSchema: string): string {
  return sqliteSchema.replace('provider = "sqlite"', 'provider = "postgresql"');
}

/** Lists timestamped migration directory names from a migrations directory. */
async function listMigrationNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((e) => /^\d{14}_/.test(e)).sort();
}

async function checkSchemaParity(): Promise<boolean> {
  const [sqliteSchema, postgresSchema] = await Promise.all([
    readFile(SQLITE_SCHEMA, "utf8"),
    readFile(POSTGRES_SCHEMA, "utf8"),
  ]);

  const normalized = normalizeToPostgres(sqliteSchema);
  if (normalized === postgresSchema) {
    console.log("✔ Schema parity: OK");
    return true;
  }

  console.error("❌ Schema parity check FAILED");
  console.error(
    `  ${POSTGRES_SCHEMA} is not identical to ${SQLITE_SCHEMA} after substituting provider.`,
  );

  // Show the first differing line for quick triage.
  const sqliteLines = normalized.split("\n");
  const pgLines = postgresSchema.split("\n");
  const maxLen = Math.max(sqliteLines.length, pgLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (sqliteLines[i] !== pgLines[i]) {
      console.error(`  First difference at line ${i + 1}:`);
      console.error(
        `    Expected (normalized sqlite): ${JSON.stringify(sqliteLines[i])}`,
      );
      console.error(
        `    Actual   (postgres):          ${JSON.stringify(pgLines[i])}`,
      );
      break;
    }
  }
  return false;
}

async function checkMigrationParity(): Promise<boolean> {
  const [sqliteMigrations, postgresMigrations] = await Promise.all([
    listMigrationNames(SQLITE_MIGRATIONS),
    listMigrationNames(POSTGRES_MIGRATIONS),
  ]);

  const onlyInSqlite = sqliteMigrations.filter(
    (m) => !postgresMigrations.includes(m),
  );
  const onlyInPostgres = postgresMigrations.filter(
    (m) => !sqliteMigrations.includes(m),
  );

  if (onlyInSqlite.length === 0 && onlyInPostgres.length === 0) {
    console.log("✔ Migration parity: OK");
    return true;
  }

  console.error("❌ Migration parity check FAILED");
  if (onlyInSqlite.length > 0) {
    console.error(
      `  Migrations in ${SQLITE_MIGRATIONS} but not ${POSTGRES_MIGRATIONS}:`,
    );
    onlyInSqlite.forEach((m) => console.error(`    - ${m}`));
  }
  if (onlyInPostgres.length > 0) {
    console.error(
      `  Migrations in ${POSTGRES_MIGRATIONS} but not ${SQLITE_MIGRATIONS}:`,
    );
    onlyInPostgres.forEach((m) => console.error(`    - ${m}`));
  }
  return false;
}

async function main() {
  const [schemaOk, migrationOk] = await Promise.all([
    checkSchemaParity(),
    checkMigrationParity(),
  ]);

  if (!schemaOk || !migrationOk) {
    console.error(
      "\nSee docs/platform/database.md §Schema governance for the schema-change workflow.",
    );
    process.exit(1);
  }

  console.log("\n✔ All schema parity checks passed.");
}

if (isMain(import.meta.url)) {
  runScript(main, "Fatal error");
}
