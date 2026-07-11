/**
 * Tests for scripts/check-schema-parity.ts core logic.
 *
 * Imports the script's exported pure functions and validates all behavior
 * branches: happy paths (real schema files), error paths (injected bad data),
 * and the main() orchestration.
 */
process.env.LOG_LEVEL = "error";

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  renderSchema,
  migrationNamesMissingFrom,
  listMigrationNames,
  validateSchemaContents,
  validateMigrationParity,
  checkSchemaParity,
  checkMigrationParity,
  main,
} from "../scripts/check-schema-parity";

const ROOT = resolve(import.meta.dirname, "..");
const SQLITE_MIGRATIONS = resolve(ROOT, "prisma/migrations");
const POSTGRES_MIGRATIONS = resolve(ROOT, "prisma/postgresql/migrations");

// ── renderSchema ──────────────────────────────────────────────────────────

test("renderSchema replaces {{PROVIDER}} with 'sqlite'", () => {
  const base = 'provider = "{{PROVIDER}}"';
  assert.equal(renderSchema(base, "sqlite"), 'provider = "sqlite"');
});

test("renderSchema replaces {{PROVIDER}} with 'postgresql'", () => {
  const base = 'provider = "{{PROVIDER}}"';
  assert.equal(renderSchema(base, "postgresql"), 'provider = "postgresql"');
});

test("renderSchema does not change other content", () => {
  const base = "datasource db {\n  provider = \"{{PROVIDER}}\"\n  url = env(\"DATABASE_URL\")\n}";
  const result = renderSchema(base, "sqlite");
  assert.ok(result.includes("url = env(\"DATABASE_URL\")"));
  assert.ok(result.includes('provider = "sqlite"'));
});

// ── migrationNamesMissingFrom ────────────────────────────────────────────

test("migrationNamesMissingFrom returns empty when both empty", () => {
  assert.deepEqual(migrationNamesMissingFrom([], []), []);
});

test("migrationNamesMissingFrom returns empty when all present in target", () => {
  const source = ["20240101_init", "20240201_users"];
  const target = ["20240101_init", "20240201_users", "20240301_extra"];
  assert.deepEqual(migrationNamesMissingFrom(source, target), []);
});

test("migrationNamesMissingFrom returns items absent from target", () => {
  const source = ["20240101_init", "20240201_users", "20240301_only_source"];
  const target = ["20240101_init", "20240201_users"];
  assert.deepEqual(migrationNamesMissingFrom(source, target), ["20240301_only_source"]);
});

test("migrationNamesMissingFrom returns all source when target is empty", () => {
  const source = ["20240101_init", "20240201_users"];
  assert.deepEqual(migrationNamesMissingFrom(source, []), source);
});

// ── listMigrationNames ───────────────────────────────────────────────────

test("listMigrationNames returns sorted timestamped migration names from real dir", async () => {
  const names = await listMigrationNames(SQLITE_MIGRATIONS);
  assert.ok(Array.isArray(names));
  assert.ok(names.length > 0, "SQLite migrations must exist");
  for (const name of names) {
    assert.match(name, /^\d{14}_/, `migration name must start with 14-digit timestamp: ${name}`);
  }
  // verify sorted
  const sorted = [...names].sort();
  assert.deepEqual(names, sorted, "migration names must be sorted");
});

// ── validateSchemaContents ───────────────────────────────────────────────

function silenceConsole<T>(fn: () => T): T {
  const origError = console.error;
  const origLog = console.log;
  console.error = () => {};
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.error = origError;
    console.log = origLog;
  }
}

test("validateSchemaContents returns true when schemas match", () => {
  const base = 'provider = "{{PROVIDER}}"\nrest';
  const sqlite = 'provider = "sqlite"\nrest';
  const pg = 'provider = "postgresql"\nrest';
  const result = silenceConsole(() => validateSchemaContents(base, sqlite, pg));
  assert.equal(result, true);
});

test("validateSchemaContents returns false when base lacks placeholder", () => {
  const result = silenceConsole(() =>
    validateSchemaContents("no placeholder", "sqlite", "pg"),
  );
  assert.equal(result, false);
});

test("validateSchemaContents returns false when SQLite schema mismatches", () => {
  const base = 'provider = "{{PROVIDER}}"\nrest';
  const badSqlite = 'provider = "sqlite"\nwrong content';
  const goodPg = 'provider = "postgresql"\nrest';
  const result = silenceConsole(() => validateSchemaContents(base, badSqlite, goodPg));
  assert.equal(result, false);
});

test("validateSchemaContents returns false when PostgreSQL schema mismatches", () => {
  const base = 'provider = "{{PROVIDER}}"\nrest';
  const goodSqlite = 'provider = "sqlite"\nrest';
  const badPg = 'provider = "postgresql"\nwrong content';
  const result = silenceConsole(() => validateSchemaContents(base, goodSqlite, badPg));
  assert.equal(result, false);
});

test("validateSchemaContents returns false when both schemas mismatch", () => {
  const base = 'provider = "{{PROVIDER}}"\noriginal';
  const result = silenceConsole(() =>
    validateSchemaContents(base, "wrong-sqlite", "wrong-pg"),
  );
  assert.equal(result, false);
});

// ── validateMigrationParity ──────────────────────────────────────────────

test("validateMigrationParity returns true when migrations are identical", () => {
  const migrations = ["20240101_init", "20240201_users"];
  const result = silenceConsole(() => validateMigrationParity(migrations, [...migrations]));
  assert.equal(result, true);
});

test("validateMigrationParity returns false when SQLite has extra migration", () => {
  const sqlite = ["20240101_init", "20240201_extra"];
  const pg = ["20240101_init"];
  const result = silenceConsole(() => validateMigrationParity(sqlite, pg));
  assert.equal(result, false);
});

test("validateMigrationParity returns false when PostgreSQL has extra migration", () => {
  const sqlite = ["20240101_init"];
  const pg = ["20240101_init", "20240201_pg_only"];
  const result = silenceConsole(() => validateMigrationParity(sqlite, pg));
  assert.equal(result, false);
});

test("validateMigrationParity returns false when both sides have unique entries", () => {
  const sqlite = ["20240101_init", "20240201_sqlite_only"];
  const pg = ["20240101_init", "20240301_pg_only"];
  const result = silenceConsole(() => validateMigrationParity(sqlite, pg));
  assert.equal(result, false);
});

// ── checkSchemaParity / checkMigrationParity (real files) ────────────────

test("checkSchemaParity passes with real schema files", async () => {
  const result = await silenceConsole(() => checkSchemaParity());
  assert.equal(result, true, "real schemas must be in parity");
});

test("checkMigrationParity passes with real migration directories", async () => {
  const result = await silenceConsole(() => checkMigrationParity());
  assert.equal(result, true, "real migration histories must be aligned");
});

// ── main() orchestration ─────────────────────────────────────────────────

test("main() logs success when all checks pass", async () => {
  let logged = "";
  const origLog = console.log;
  console.log = (msg: string) => { logged += msg; };
  const origError = console.error;
  console.error = () => {};
  try {
    await main(
      async () => true,
      async () => true,
      (_code: number) => { throw new Error("unexpected exit"); },
    );
  } finally {
    console.log = origLog;
    console.error = origError;
  }
  assert.ok(logged.includes("All schema parity checks passed"), "should log success");
});

test("main() calls exit(1) when schema parity fails", async () => {
  let exitCode: number | undefined;
  const origError = console.error;
  console.error = () => {};
  try {
    await main(
      async () => false,
      async () => true,
      (code: number) => { exitCode = code; throw new Error("exit"); },
    );
  } catch (e) {
    if ((e as Error).message !== "exit") throw e;
  } finally {
    console.error = origError;
  }
  assert.equal(exitCode, 1);
});

test("main() calls exit(1) when migration parity fails", async () => {
  let exitCode: number | undefined;
  const origError = console.error;
  console.error = () => {};
  try {
    await main(
      async () => true,
      async () => false,
      (code: number) => { exitCode = code; throw new Error("exit"); },
    );
  } catch (e) {
    if ((e as Error).message !== "exit") throw e;
  } finally {
    console.error = origError;
  }
  assert.equal(exitCode, 1);
});
