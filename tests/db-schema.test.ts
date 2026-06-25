import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

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

test("PostgreSQL Prisma schema stays in parity with the default schema", async () => {
  const [sqliteSchema, postgresSchema] = await Promise.all([
    readFile(SQLITE_SCHEMA, "utf8"),
    readFile(POSTGRES_SCHEMA, "utf8"),
  ]);

  const normalized = normalizeToPostgres(sqliteSchema);

  // Find the first differing line for a helpful failure message.
  if (normalized !== postgresSchema) {
    const sqliteLines = normalized.split("\n");
    const pgLines = postgresSchema.split("\n");
    const maxLen = Math.max(sqliteLines.length, pgLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (sqliteLines[i] !== pgLines[i]) {
        assert.fail(
          `Schema drift at line ${i + 1}.\n` +
            `  Expected (normalized sqlite): ${JSON.stringify(sqliteLines[i])}\n` +
            `  Actual   (postgres):          ${JSON.stringify(pgLines[i])}\n` +
            "Run `npm run schema:check-parity` for details. See docs/platform/database.md §Schema governance for the schema-change workflow.",
        );
      }
    }
  }

  assert.equal(
    postgresSchema,
    normalized,
    `${POSTGRES_SCHEMA} must be byte-identical to ${SQLITE_SCHEMA} after substituting provider = "sqlite" → "postgresql".`,
  );
});

test("SQLite schema contains exactly one provider = sqlite line (datasource block only)", async () => {
  const sqliteSchema = await readFile(SQLITE_SCHEMA, "utf8");

  const count = (sqliteSchema.match(/provider\s*=\s*"sqlite"/g) ?? []).length;
  assert.equal(
    count,
    1,
    `Expected exactly 1 occurrence of provider = "sqlite" in ${SQLITE_SCHEMA} but found ${count}. ` +
      "Update the normalization in scripts/check-schema-parity.ts if the datasource block structure changed.",
  );
});

test("SQLite and PostgreSQL migration directories contain the same named migrations", async () => {
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

  assert.deepEqual(
    onlyInSqlite,
    [],
    `Migrations in ${SQLITE_MIGRATIONS} but not ${POSTGRES_MIGRATIONS}: ${onlyInSqlite.join(", ")}. ` +
      "Add a corresponding migration to both directories. See docs/platform/database.md §Schema governance for the schema-change workflow.",
  );

  assert.deepEqual(
    onlyInPostgres,
    [],
    `Migrations in ${POSTGRES_MIGRATIONS} but not ${SQLITE_MIGRATIONS}: ${onlyInPostgres.join(", ")}. ` +
      "Add a corresponding migration to both directories. See docs/platform/database.md §Schema governance for the schema-change workflow.",
  );
});
