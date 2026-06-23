import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const SQLITE_SCHEMA = "prisma/schema.prisma";
const POSTGRES_SCHEMA = "prisma/postgresql/schema.prisma";

test("PostgreSQL Prisma schema stays in parity with the default schema", async () => {
  const [sqliteSchema, postgresSchema] = await Promise.all([
    readFile(SQLITE_SCHEMA, "utf8"),
    readFile(POSTGRES_SCHEMA, "utf8"),
  ]);

  assert.equal(
    postgresSchema,
    sqliteSchema.replace('provider = "sqlite"', 'provider = "postgresql"'),
  );
});
