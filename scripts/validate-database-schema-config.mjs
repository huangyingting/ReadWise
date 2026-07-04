#!/usr/bin/env node

const SQLITE_SCHEMA = "prisma/schema.prisma";
const POSTGRES_SCHEMA = "prisma/postgresql/schema.prisma";
const POSTGRES_PREFIXES = ["postgresql://", "postgres://"];

function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function databaseProvider(databaseUrl) {
  if (!databaseUrl) return null;
  if (databaseUrl.startsWith("file:")) return "SQLite";
  if (POSTGRES_PREFIXES.some((prefix) => databaseUrl.startsWith(prefix))) {
    return "PostgreSQL";
  }
  return null;
}

function schemaProvider(schemaPath) {
  const normalized = normalizePath(schemaPath);
  if (normalized === SQLITE_SCHEMA || normalized.endsWith(`/${SQLITE_SCHEMA}`)) {
    return "SQLite";
  }
  if (normalized === POSTGRES_SCHEMA || normalized.endsWith(`/${POSTGRES_SCHEMA}`)) {
    return "PostgreSQL";
  }
  return "unknown";
}

function expectedSchema(provider) {
  return provider === "PostgreSQL" ? POSTGRES_SCHEMA : SQLITE_SCHEMA;
}

function fail(message) {
  console.error(`Database schema configuration error: ${message}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const schemaPath = process.env.PRISMA_SCHEMA_PATH?.trim() || SQLITE_SCHEMA;
const dbProvider = databaseProvider(databaseUrl);
const prismaProvider = schemaProvider(schemaPath);

if (!dbProvider) {
  fail("DATABASE_URL must be set to a SQLite file: URL or PostgreSQL URL.");
}

if (prismaProvider === "unknown") {
  fail(
    `PRISMA_SCHEMA_PATH must be ${SQLITE_SCHEMA} for SQLite or ${POSTGRES_SCHEMA} for PostgreSQL.`,
  );
}

if (dbProvider !== prismaProvider) {
  fail(
    `DATABASE_URL targets ${dbProvider}, but PRISMA_SCHEMA_PATH selects the ${prismaProvider} Prisma schema. ` +
      `Set PRISMA_SCHEMA_PATH=${expectedSchema(dbProvider)} or use a ${prismaProvider} DATABASE_URL.`,
  );
}

console.log(`Database schema configuration OK (${dbProvider}).`);
