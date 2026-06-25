/**
 * Shared PostgreSQL integration test helpers.
 *
 * Provides row-ID generation, cleanup sweeps, SQL utilities, and migration
 * loading for the live-PG integration suite.  No global state beyond the
 * shared Prisma singleton.
 */

import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { PREFIX } from "./db-config";

const ROOT = process.cwd();

/** Returns a prefixed, UUID-based ID for integration-test rows. */
export function id(label: string): string {
  return `${PREFIX}${label}_${randomUUID().replace(/-/g, "")}`;
}

/** Deletes all rows created by the integration suite (identified by PREFIX). */
export async function cleanIntegrationRows(): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: PREFIX } } });
  await prisma.savedWord.deleteMany({ where: { userId: { startsWith: PREFIX } } });
  await prisma.article.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.tag.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.job.deleteMany({ where: { dedupeKey: { startsWith: PREFIX } } });
}

/** Safely quotes a PostgreSQL identifier. */
export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Splits a SQL string into individual statements, correctly handling single
 * quotes, double quotes, line comments, block comments, and dollar-quoting.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarQuote: string | null = null;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, i)) {
        i += dollarQuote.length - 1;
        dollarQuote = null;
      }
      continue;
    }
    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingleQuote) {
      if (char === "'" && next === "'") {
        i += 1;
      } else if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && next === '"') {
        i += 1;
      } else if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (char === "'") {
      inSingleQuote = true;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (char === "$") {
      const match = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/);
      if (match) {
        dollarQuote = match[0];
        i += dollarQuote.length - 1;
      }
      continue;
    }
    if (char === ";") {
      const statement = sql.slice(start, i).trim();
      if (statement.length > 0) statements.push(statement);
      start = i + 1;
    }
  }

  const trailing = sql.slice(start).trim();
  if (trailing.length > 0) statements.push(trailing);
  return statements;
}

/** Executes each statement in a SQL string against the given transaction client. */
export async function applySql(db: Prisma.TransactionClient, sql: string): Promise<void> {
  for (const statement of splitSqlStatements(sql)) {
    await db.$executeRawUnsafe(statement);
  }
}

/** Reads and sorts all PostgreSQL migration files from prisma/postgresql/migrations. */
export async function readPostgresMigrations(): Promise<Array<{ name: string; sql: string }>> {
  const migrationsRoot = join(ROOT, "prisma/postgresql/migrations");
  const migrationNames = (await readdir(migrationsRoot))
    .filter((name) => name !== "migration_lock.toml")
    .sort();

  return Promise.all(
    migrationNames.map(async (name) => ({
      name,
      sql: await readFile(join(migrationsRoot, name, "migration.sql"), "utf8"),
    })),
  );
}
