import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function runValidator(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, ["scripts/validate-database-schema-config.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      ...env,
    },
  });
}

test("database schema config validator accepts PostgreSQL schema pairing", () => {
  const result = runValidator({
    DATABASE_URL: "postgresql://db.example/readwise",
    PRISMA_SCHEMA_PATH: "prisma/postgresql/schema.prisma",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Database schema configuration OK \(PostgreSQL\)/);
});

test("database schema config validator accepts SQLite default schema pairing", () => {
  const result = runValidator({
    DATABASE_URL: "file:./dev.db",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Database schema configuration OK \(SQLite\)/);
});

test("database schema config validator rejects provider mismatches", () => {
  const result = runValidator({
    DATABASE_URL: "postgresql://db.example/readwise",
    PRISMA_SCHEMA_PATH: "prisma/schema.prisma",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /DATABASE_URL targets PostgreSQL/);
  assert.match(result.stderr, /PRISMA_SCHEMA_PATH=prisma\/postgresql\/schema\.prisma/);
});

test("database schema config validator rejects invalid or missing database URLs", () => {
  for (const env of [
    {},
    { DATABASE_URL: "mysql://db.example/readwise" },
    { DATABASE_URL: "postgresql://[" },
  ]) {
    const result = runValidator(env);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /DATABASE_URL must be set to a SQLite file: URL or PostgreSQL URL/);
  }
});

test("database schema config validator rejects unknown schema paths", () => {
  const result = runValidator({
    DATABASE_URL: "file:./dev.db",
    PRISMA_SCHEMA_PATH: "prisma/custom/schema.prisma",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /PRISMA_SCHEMA_PATH must be prisma\/schema\.prisma for SQLite/);
});
