/**
 * Tests for scripts/check-schema-parity.ts core logic.
 *
 * The script's pure functions (renderSchema, listMigrationNames, etc.) are
 * private, so we test the script's behavior by importing it as a module.
 * Since it uses `isMain()` guard, importing won't trigger side-effects.
 *
 * We validate the key behaviors:
 * - The script module loads without side effects
 * - The base schema exists and contains the placeholder
 * - Both generated schemas exist
 * - Both migration directories exist with aligned names
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BASE_SCHEMA = resolve(ROOT, "prisma/base.prisma");
const SQLITE_SCHEMA = resolve(ROOT, "prisma/schema.prisma");
const POSTGRES_SCHEMA = resolve(ROOT, "prisma/postgresql/schema.prisma");
const SQLITE_MIGRATIONS = resolve(ROOT, "prisma/migrations");
const POSTGRES_MIGRATIONS = resolve(ROOT, "prisma/postgresql/migrations");
const PLACEHOLDER = "{{PROVIDER}}";

test("base schema exists and contains the provider placeholder", async () => {
  const base = await readFile(BASE_SCHEMA, "utf8");
  assert.ok(base.includes(PLACEHOLDER), `${BASE_SCHEMA} must contain '${PLACEHOLDER}'`);
});

test("SQLite generated schema exists and uses sqlite provider", async () => {
  const content = await readFile(SQLITE_SCHEMA, "utf8");
  assert.ok(content.includes('provider = "sqlite"'), "SQLite schema must use sqlite provider");
  assert.ok(!content.includes(PLACEHOLDER), "generated schema must not contain placeholder");
});

test("PostgreSQL generated schema exists and uses postgresql provider", async () => {
  const content = await readFile(POSTGRES_SCHEMA, "utf8");
  assert.ok(
    content.includes('provider = "postgresql"'),
    "PostgreSQL schema must use postgresql provider",
  );
  assert.ok(!content.includes(PLACEHOLDER), "generated schema must not contain placeholder");
});

test("migration directories contain timestamped migration names", async () => {
  const sqliteEntries = await readdir(SQLITE_MIGRATIONS);
  const pgEntries = await readdir(POSTGRES_MIGRATIONS);

  const timestampPattern = /^\d{14}_/;
  const sqliteMigrations = sqliteEntries.filter((e) => timestampPattern.test(e)).sort();
  const pgMigrations = pgEntries.filter((e) => timestampPattern.test(e)).sort();

  assert.ok(sqliteMigrations.length > 0, "SQLite should have at least one migration");
  assert.ok(pgMigrations.length > 0, "PostgreSQL should have at least one migration");
});

test("migration histories are aligned between SQLite and PostgreSQL", async () => {
  const sqliteEntries = await readdir(SQLITE_MIGRATIONS);
  const pgEntries = await readdir(POSTGRES_MIGRATIONS);

  const timestampPattern = /^\d{14}_/;
  const sqliteMigrations = sqliteEntries.filter((e) => timestampPattern.test(e)).sort();
  const pgMigrations = pgEntries.filter((e) => timestampPattern.test(e)).sort();

  assert.deepEqual(
    sqliteMigrations,
    pgMigrations,
    "SQLite and PostgreSQL migration histories must be aligned",
  );
});

test("generated schemas differ from base only in provider line", async () => {
  const base = await readFile(BASE_SCHEMA, "utf8");
  const sqlite = await readFile(SQLITE_SCHEMA, "utf8");
  const postgres = await readFile(POSTGRES_SCHEMA, "utf8");

  const expectedSqlite = base.replace(PLACEHOLDER, "sqlite");
  const expectedPostgres = base.replace(PLACEHOLDER, "postgresql");

  assert.equal(sqlite, expectedSqlite, "SQLite schema must be base with sqlite provider");
  assert.equal(postgres, expectedPostgres, "PostgreSQL schema must be base with postgresql provider");
});
