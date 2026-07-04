import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const SQLITE_SCHEMA = "prisma/schema.prisma";
const POSTGRES_SCHEMA = "prisma/postgresql/schema.prisma";
const BASE_SCHEMA = "prisma/base.prisma";
const SQLITE_MIGRATIONS = "prisma/migrations";
const POSTGRES_MIGRATIONS = "prisma/postgresql/migrations";
const PROVIDER_PLACEHOLDER = "{{PROVIDER}}";

function renderSchema(baseSchema: string, provider: "sqlite" | "postgresql"): string {
  return baseSchema.replace(PROVIDER_PLACEHOLDER, provider);
}

/** Lists timestamped migration directory names from a migrations directory. */
async function listMigrationNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((e) => /^\d{14}_/.test(e)).sort();
}

test("generated Prisma schemas stay in parity with the base schema", async () => {
  const [baseSchema, sqliteSchema, postgresSchema] = await Promise.all([
    readFile(BASE_SCHEMA, "utf8"),
    readFile(SQLITE_SCHEMA, "utf8"),
    readFile(POSTGRES_SCHEMA, "utf8"),
  ]);

  assert.ok(
    baseSchema.includes(PROVIDER_PLACEHOLDER),
    `${BASE_SCHEMA} must contain ${PROVIDER_PLACEHOLDER} in the datasource provider field.`,
  );

  const expectedSqlite = renderSchema(baseSchema, "sqlite");
  const expectedPostgres = renderSchema(baseSchema, "postgresql");

  // Find the first differing line for a helpful failure message.
  for (const { path, expected, actual } of [
    { path: SQLITE_SCHEMA, expected: expectedSqlite, actual: sqliteSchema },
    { path: POSTGRES_SCHEMA, expected: expectedPostgres, actual: postgresSchema },
  ]) {
    if (expected === actual) continue;

    const expectedLines = expected.split("\n");
    const actualLines = actual.split("\n");
    const maxLen = Math.max(expectedLines.length, actualLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (expectedLines[i] === actualLines[i]) continue;

      assert.fail(
        `${path} drifted from ${BASE_SCHEMA} at line ${i + 1}.\n` +
          `  Expected generated: ${JSON.stringify(expectedLines[i])}\n` +
          `  Actual committed:   ${JSON.stringify(actualLines[i])}\n` +
          "Run `npm run schema:generate` and `npm run schema:check-parity`. See docs/platform/database.md §Schema governance for the schema-change workflow.",
      );
    }
  }

  assert.equal(sqliteSchema, expectedSqlite);
  assert.equal(postgresSchema, expectedPostgres);
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
