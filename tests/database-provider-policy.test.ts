import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import {
  databaseProviderFromUrl,
  databaseUrlForPrismaAdapter,
  inspectDatabaseSchemaPairing,
  isSupportedDatabaseUrl,
  prismaSchemaProviderFromPath,
} from "../src/lib/database-provider-policy.mjs";

test("database provider policy classifies supported URLs", () => {
  assert.equal(databaseProviderFromUrl("file:./dev.db"), "sqlite");
  assert.equal(databaseProviderFromUrl("file::memory:"), "sqlite");
  assert.equal(databaseProviderFromUrl("postgresql://db.example/readwise"), "postgresql");
  assert.equal(databaseProviderFromUrl("postgres://db.example/readwise"), "postgresql");
  assert.equal(databaseProviderFromUrl("mysql://db.example/readwise"), null);
  assert.equal(databaseProviderFromUrl("file:"), null);
});

test("database provider policy validates URL syntax independently of provider hints", () => {
  assert.equal(isSupportedDatabaseUrl("file:./dev.db"), true);
  assert.equal(isSupportedDatabaseUrl("postgresql://db.example/readwise"), true);
  assert.equal(isSupportedDatabaseUrl("postgresql://["), false);
  assert.equal(databaseProviderFromUrl("postgresql://["), "postgresql");
});

test("database provider policy recognizes relative and absolute schema paths", () => {
  assert.equal(prismaSchemaProviderFromPath("prisma/schema.prisma"), "sqlite");
  assert.equal(prismaSchemaProviderFromPath("/app/prisma/schema.prisma"), "sqlite");
  assert.equal(
    prismaSchemaProviderFromPath("C:\\app\\prisma\\postgresql\\schema.prisma"),
    "postgresql",
  );
  assert.equal(prismaSchemaProviderFromPath("prisma/custom/schema.prisma"), "unknown");
});

test("database provider policy accepts aligned schema pairings", () => {
  assert.deepEqual(
    inspectDatabaseSchemaPairing("file:./dev.db", "prisma/schema.prisma"),
    { ok: true, provider: "sqlite", schemaPath: "prisma/schema.prisma" },
  );
  assert.deepEqual(
    inspectDatabaseSchemaPairing(
      "postgresql://db.example/readwise",
      "prisma/postgresql/schema.prisma",
    ),
    {
      ok: true,
      provider: "postgresql",
      schemaPath: "prisma/postgresql/schema.prisma",
    },
  );
});

test("database provider policy owns pairing diagnostics", () => {
  const invalidUrl = inspectDatabaseSchemaPairing("mysql://db.example/readwise");
  const unknownSchema = inspectDatabaseSchemaPairing(
    "file:./dev.db",
    "prisma/custom/schema.prisma",
  );
  const mismatch = inspectDatabaseSchemaPairing(
    "postgresql://db.example/readwise",
    "prisma/schema.prisma",
  );

  assert.equal(invalidUrl.ok, false);
  assert.equal(invalidUrl.code, "invalid_database_url");
  assert.equal(unknownSchema.ok, false);
  assert.equal(unknownSchema.code, "unknown_prisma_schema_path");
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "database_prisma_schema_mismatch");
  assert.match(mismatch.message, /PRISMA_SCHEMA_PATH=prisma\/postgresql\/schema\.prisma/);
});

test("database provider policy resolves relative SQLite URLs from the schema directory", () => {
  const cwd = "/workspace/readwise";
  assert.equal(
    databaseUrlForPrismaAdapter("file:./dev.db", "prisma/schema.prisma", cwd),
    `file:${join(cwd, "prisma/dev.db").replace(/\\/g, "/")}`,
  );
  assert.equal(
    databaseUrlForPrismaAdapter(
      "file:../root.db?connection_limit=1",
      "prisma/schema.prisma",
      cwd,
    ),
    `file:${join(cwd, "root.db").replace(/\\/g, "/")}?connection_limit=1`,
  );
});

test("database provider policy preserves non-relative adapter URLs", () => {
  assert.equal(
    databaseUrlForPrismaAdapter("file:/tmp/readwise.db", "prisma/schema.prisma"),
    "file:/tmp/readwise.db",
  );
  assert.equal(
    databaseUrlForPrismaAdapter("file::memory:", "prisma/schema.prisma"),
    "file::memory:",
  );
  assert.equal(
    databaseUrlForPrismaAdapter(
      "postgresql://db.example/readwise",
      "prisma/postgresql/schema.prisma",
    ),
    "postgresql://db.example/readwise",
  );
});