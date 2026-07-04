/**
 * Schema Parity Check (REF-069)
 *
 * Verifies that generated Prisma schemas still match prisma/base.prisma, the
 * single source of truth. The generated schemas must be byte-identical except
 * for the datasource provider line:
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

const BASE_SCHEMA = "prisma/base.prisma";
const SQLITE_SCHEMA = "prisma/schema.prisma";
const POSTGRES_SCHEMA = "prisma/postgresql/schema.prisma";
const SQLITE_MIGRATIONS = "prisma/migrations";
const POSTGRES_MIGRATIONS = "prisma/postgresql/migrations";
const PLACEHOLDER = '{{PROVIDER}}';

function renderSchema(base: string, provider: "sqlite" | "postgresql"): string {
  return base.replace(PLACEHOLDER, provider);
}

/** Lists timestamped migration directory names from a migrations directory. */
async function listMigrationNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((e) => /^\d{14}_/.test(e)).sort();
}

function migrationNamesMissingFrom(source: string[], target: string[]): string[] {
  return source.filter((m) => !target.includes(m));
}

function reportFirstSchemaDifference(expected: string, actual: string): void {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const maxLen = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (expectedLines[i] !== actualLines[i]) {
      console.error(`  First difference at line ${i + 1}:`);
      console.error(`    Expected generated: ${JSON.stringify(expectedLines[i])}`);
      console.error(`    Actual committed:   ${JSON.stringify(actualLines[i])}`);
      break;
    }
  }
}

function reportGeneratedSchemaDifference(path: string, expected: string, actual: string): void {
  console.error(`  ${path} is not generated from ${BASE_SCHEMA}.`);
  console.error("  Run `npm run schema:generate` and commit the regenerated schema.");
  reportFirstSchemaDifference(expected, actual);
}

async function checkSchemaParity(): Promise<boolean> {
  const [baseSchema, sqliteSchema, postgresSchema] = await Promise.all([
    readFile(BASE_SCHEMA, "utf8"),
    readFile(SQLITE_SCHEMA, "utf8"),
    readFile(POSTGRES_SCHEMA, "utf8"),
  ]);

  if (!baseSchema.includes(PLACEHOLDER)) {
    console.error("❌ Schema parity check FAILED");
    console.error(
      `  ${BASE_SCHEMA} must contain the placeholder '${PLACEHOLDER}' in the datasource provider field.`,
    );
    return false;
  }

  const expectedSqlite = renderSchema(baseSchema, "sqlite");
  const expectedPostgres = renderSchema(baseSchema, "postgresql");
  const generatedSchemasMatch =
    sqliteSchema === expectedSqlite && postgresSchema === expectedPostgres;
  if (generatedSchemasMatch) {
    console.log("✔ Schema parity: OK");
    return true;
  }

  console.error("❌ Schema parity check FAILED");
  if (sqliteSchema !== expectedSqlite) {
    reportGeneratedSchemaDifference(SQLITE_SCHEMA, expectedSqlite, sqliteSchema);
  }
  if (postgresSchema !== expectedPostgres) {
    reportGeneratedSchemaDifference(POSTGRES_SCHEMA, expectedPostgres, postgresSchema);
  }
  return false;
}

async function checkMigrationParity(): Promise<boolean> {
  const [sqliteMigrations, postgresMigrations] = await Promise.all([
    listMigrationNames(SQLITE_MIGRATIONS),
    listMigrationNames(POSTGRES_MIGRATIONS),
  ]);

  const onlyInSqlite = migrationNamesMissingFrom(
    sqliteMigrations,
    postgresMigrations,
  );
  const onlyInPostgres = migrationNamesMissingFrom(
    postgresMigrations,
    sqliteMigrations,
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
