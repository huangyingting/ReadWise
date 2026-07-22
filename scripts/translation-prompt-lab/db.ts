/**
 * Shared `better-sqlite3` access for the translation lab / production batch
 * script. Provider-dbs are always opened READ-ONLY (matches the existing
 * repo convention in `scripts/difficulty-eval.ts` and `sample.ts` — these
 * are ingestion source databases, never mutated by scripts) — writes always
 * go to a separate output database (see `store.ts`).
 */
import { createRequire } from "node:module";

export type SqliteStatement = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint };
};

export type SqliteDatabase = {
  prepare: (sql: string) => SqliteStatement;
  exec: (sql: string) => void;
  transaction: <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => void;
  close: () => void;
  pragma: (sql: string) => unknown;
};

type DatabaseCtor = new (
  path: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase;

function loadDatabaseCtor(): DatabaseCtor {
  const require = createRequire(import.meta.url);
  return require("better-sqlite3") as DatabaseCtor;
}

export function openReadOnly(pathValue: string): SqliteDatabase {
  const Database = loadDatabaseCtor();
  return new Database(pathValue, { readonly: true, fileMustExist: true });
}

/** Opens (creating if needed) a database for writes, with WAL for concurrent-safe batch writes. */
export function openReadWrite(pathValue: string): SqliteDatabase {
  const Database = loadDatabaseCtor();
  const db = new Database(pathValue);
  db.pragma("journal_mode = WAL");
  return db;
}
